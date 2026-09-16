import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands, postPatterns, templateUsage, skills, ownPosts } from '@/lib/db/schema';
import { eq, and, gte, desc, notInArray, sql } from 'drizzle-orm';
import { getActiveBrandId } from '@/lib/active-brand';
import type { PostLength } from '@/components/board/types';
// Canonical post-generation engine, shared with the connector so both generate identically. Edit the prompt/template logic in lib/post-prompt.ts, never re-fork it here.
import { buildPrompt, type FullPattern, LENGTH_GUIDE, enforceTwitterBreaks, stripEmDashes } from '@/lib/post-prompt';
import { callAI, parseJSON, MODEL_CREATIVE } from '@/lib/ai';
import { applyRulesFix } from '@/lib/rules-fixer';
import { GLOBAL_RULES_PROMPT, STRUCTURAL_RULES } from '@/lib/global-rules';
import { buildCraftRules, looksLikeNewsReaction } from '@/lib/craft-rules';
import { loadVoiceContext, formatVoiceSection } from '@/lib/voice-context';
import { deductCredits, refundCredits, checkDailyLimit, checkDailyScrapeLimit, recordDailyAction } from '@/lib/credits';
// Credit model: board generates are hard-capped (no credits). Chat is credit-gated (no daily cap).
// chat_message (10 cr) charged upfront for any chat AI call.
// chat_generate (10 cr) charged additionally when chat produces posts (= 20 cr total).
// scrape_twitter (3 cr) charged for any Twitter lookup in chat.
import { extractUrl, scrapeUrl } from '@/lib/scrape';
import {
  detectTwitterLookup, fetchUserTweets, searchTweets, fetchTweetById,
  extractTweetId, formatTweetsText, formatSingleTweet,
  xAvailable,
} from '@/lib/twitterapi';
import { ensureVaultMirrored } from '@/lib/vault/sync';
import { buildDraftSourceInputs, planPost } from '@/lib/agents/post-strategist';
import { isAutoRotationEligible } from '@/lib/pattern-categories';
import { modelAvailable } from '@/lib/providers';

// LENGTH_GUIDE, FullPattern, deriveMirrorSpec, buildTemplateInstructions, enforceTwitterBreaks, and
// CONTENT_STYLE_DIRECTIVE now live in lib/post-prompt.ts (shared with the connector). buildPrompt too.

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { topic, length = 'auto', context, chat = false, directWrite = false, templateId: rawTemplateId, useTemplate, useNewsTemplate, draftId, history, platform = 'both' } = await req.json().catch(() => ({})) as { topic?: string; length?: string; context?: string; chat?: boolean; directWrite?: boolean; templateId?: string; useTemplate?: boolean; useNewsTemplate?: boolean; draftId?: string; history?: Array<{ role: 'user' | 'assistant'; content: string }>; platform?: 'twitter' | 'linkedin' | 'both' };
  if (!topic?.trim()) return NextResponse.json({ error: 'topic is required' }, { status: 400 });

  const targetPlatform: 'twitter' | 'linkedin' | 'both' =
    platform === 'twitter' || platform === 'linkedin' ? platform : 'both';

  if (draftId?.startsWith('demo-')) {
    return NextResponse.json({ error: 'Cannot modify demo content' }, { status: 400 });
  }

  if (!(await modelAvailable())) {
    return NextResponse.json({ error: 'No model backend is set up. Open /setup to connect one.' }, { status: 503 });
  }

  const userId = session.user.id;

  // ── Twitter lookup: detect before spending generate credits ─────────────────
  // Skip when directWrite=true, caller (pulse QRT, etc.) explicitly wants a post,
  // not a lookup, even if the topic mentions @handles or tweets.
  if (chat && !directWrite && (await xAvailable())) {
    const twitterIntent = detectTwitterLookup(topic);
    if (twitterIntent) {
      const scrapeCheck = await checkDailyScrapeLimit(userId);
      if (scrapeCheck.allowed) {
        const { ok, balance, required } = await deductCredits(userId, 'scrape_twitter');
        if (!ok) {
          return NextResponse.json(
            { type: 'info', text: `You need ${required} credits for a Twitter lookup but only have ${balance}. Upgrade your plan or wait for your monthly reset.` },
          );
        }
        try {
          let text = '';
          if (twitterIntent.intent === 'tweet_url') {
            const id = extractTweetId(twitterIntent.tweetUrl);
            if (!id) {
              text = "Couldn't parse that tweet URL. Paste the full link (x.com/username/status/12345...) and I'll pull it up.";
            } else {
              const tweet = await fetchTweetById(id);
              text = tweet ? formatSingleTweet(tweet) : 'That tweet is either deleted or from a protected account.';
            }
          } else if (twitterIntent.intent === 'profile') {
            const tweets = await fetchUserTweets(twitterIntent.handle, 10);
            text = formatTweetsText(tweets, `@${twitterIntent.handle}`);
          } else {
            const tweets = await searchTweets(twitterIntent.query, 10);
            text = formatTweetsText(tweets);
          }
          return NextResponse.json({ type: 'info', text });
        } catch {
          return NextResponse.json({
            type: 'info',
            text: "Twitter lookup hit a snag — try again in a moment, or paste the tweet/profile URL directly and I'll use it as writing context.",
          });
        }
      }
      // Daily scrape limit reached, skip the Twitter fetch and fall through to post generation
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const detectedUrl = extractUrl(topic);
  let scrapedContext: string | undefined;

  if (detectedUrl) {
    try {
      const scrapeResult = await scrapeUrl(detectedUrl);
      scrapedContext = `## Scraped content (${scrapeResult.type})\n${scrapeResult.title ? `Title: ${scrapeResult.title}\n` : ''}${scrapeResult.content}`;
    } catch {
      // proceed without scraped context
    }
  }

  if (!chat) {
    // Board generate: daily hard cap is the only gate, no credit deduction
    const dailyCheck = await checkDailyLimit(userId, 'generate');
    if (!dailyCheck.allowed) {
      return NextResponse.json(
        { error: 'Daily limit reached', used: dailyCheck.used, limit: dailyCheck.limit, type: 'daily_limit_reached' },
        { status: 429 },
      );
    }
  } else {
    // Chat: credit-gated, no daily cap
    const { ok, balance, required } = await deductCredits(userId, 'chat_message');
    if (!ok) {
      return NextResponse.json(
        { error: 'Out of credits', balance, required, type: 'insufficient_credits' },
        { status: 402 },
      );
    }
  }

  const activeBrandId = await getActiveBrandId(userId);
  const [brand] = activeBrandId ? await db.select({
    styleGuideMd: brands.styleGuideMd,
    voiceDocument: brands.voiceDocument,
    name: brands.name,
    id: brands.id,
    contentStyle: brands.contentStyle,
    niche: brands.niche,
  })
    .from(brands)
    .where(eq(brands.id, activeBrandId))
    .limit(1) : [];

  // Build 3-pass voice context: pass2 = synthesized voiceDocument, pass3 = unabsorbed delta
  const voiceCtx = brand?.id ? await loadVoiceContext(brand.id) : { pass2: '', pass3: '' };
  const voiceGuide = formatVoiceSection(voiceCtx);

  // Fire-and-forget: mark active skills as applied so confidence decay doesn't penalise used skills
  if (brand?.id) {
    db.update(skills)
      .set({
        lastAppliedAt: new Date(),
        timesApplied: sql`COALESCE(${skills.timesApplied}, 0) + 1`,
      })
      .where(and(eq(skills.brandId, brand.id), eq(skills.status, 'active')))
      .catch(() => {}); // non-fatal
  }

  const brandName = brand?.name ?? 'the creator';
  const guide = LENGTH_GUIDE[length as PostLength] ?? LENGTH_GUIDE.auto;

  let vaultStrategy: Awaited<ReturnType<typeof planPost>> | null = null;
  if (brand?.id) {
    await ensureVaultMirrored(userId, brand.id);
    vaultStrategy = await planPost({
      userId,
      brandId: brand.id,
      topic: [topic, context].filter(Boolean).join('\n\n'),
      noteLimit: 7,
      maxVisuals: targetPlatform === 'linkedin' ? 2 : 1,
      visualHint: /\b(image|visual|screenshot|photo|chart|meme|diagram|carousel)\b/i.test(`${topic}\n${context ?? ''}`),
    });
  }

  const visualBlock = vaultStrategy?.visuals.length
    ? `## Visuals Lore recommends\n${vaultStrategy.visuals.map(({ asset, reason, score }, i) => `${i + 1}. ${asset.originalFilename} (${asset.fileUrl}) — ${asset.captionSummary ?? 'uploaded visual'}; tags: ${(asset.tags ?? []).slice(0, 8).join(', ') || 'none'}; reason: ${reason}; score: ${score.toFixed(1)}`).join('\n')}\n\nIf an image genuinely fits the post, write as if it will be attached. If it does not fit, ignore it.`
    : '';
  const draftSourceInputs = vaultStrategy ? buildDraftSourceInputs(vaultStrategy) : [];

  const mergedContext = [scrapedContext, context, vaultStrategy?.promptBlock, visualBlock]
    .filter(Boolean)
    .join('\n\n') || undefined;

  // Load recent own posts for TWO things:
  //   1. Dedup context: what's already been posted so the model doesn't repeat
  //   2. Voice few-shot: top-performing posts as examples of how this person actually writes
  let recentPostsContext: string | undefined;
  if (brand?.id) {
    const since = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000);
    const recent = await db
      .select({
        content: ownPosts.content,
        postedAt: ownPosts.postedAt,
        likeCount: ownPosts.likeCount,
        retweetCount: ownPosts.retweetCount,
        replyCount: ownPosts.replyCount,
        platform: ownPosts.platform,
      })
      .from(ownPosts)
      .where(and(eq(ownPosts.brandId, brand.id), gte(ownPosts.postedAt, since)))
      .orderBy(desc(ownPosts.postedAt))
      .limit(60);

    if (recent.length > 0) {
      // Voice few-shot: top 4 by engagement (likes + reposts + replies), full text.
      // Filter to the requested platform when possible so the examples match shape.
      const candidatePool = recent.filter(p => {
        if (targetPlatform === 'twitter') return p.platform === 'twitter';
        if (targetPlatform === 'linkedin') return p.platform === 'linkedin';
        return true;
      });
      const pool = candidatePool.length >= 3 ? candidatePool : recent;
      const interactions = (p: typeof recent[number]) =>
        (p.likeCount ?? 0) + (p.retweetCount ?? 0) + (p.replyCount ?? 0);
      const topByEngagement = [...pool]
        .sort((a, b) => interactions(b) - interactions(a))
        .slice(0, 4)
        .filter(p => p.content.trim().length > 0);

      const voiceExamples = topByEngagement.length > 0
        ? `## How this creator actually writes — voice examples from their own published posts\nMatch this rhythm, sentence length, vocabulary, density, and opener style. Do NOT borrow the topics — only the SHAPE of the writing. If you find yourself writing like an analyst or a press release, stop and reread these examples.\n\n${topByEngagement.map((p, i) => `### Example ${i + 1} (${p.platform === 'linkedin' ? 'LinkedIn' : 'X'})\n${p.content.trim()}`).join('\n\n')}`
        : '';

      // Dedup list: thin one-liner of every recent post so the model knows what's
      // already covered. Separate from the voice examples (which are full posts).
      const dedupLines = recent.map(p => {
        const date = new Date(p.postedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        return `- [${date}] ${p.content.slice(0, 120).replace(/\n/g, ' ')}`;
      }).join('\n');
      const dedupBlock = `## Already posted in the last 6 months\nAvoid repeating the same angle, story, or specific data point from these posts. A fresh take on a related topic is fine — an identical angle is not.\n\n${dedupLines}`;

      recentPostsContext = voiceExamples
        ? `${voiceExamples}\n\n${dedupBlock}`
        : dedupBlock;
    }
  }

  // News reactions no longer FORCE the 3-takeaway template. That was producing
  // fabricated friend-testimonies and forcing three-numbered structure even when
  // the news only had one strong angle. Instead, news cards flow through the
  // normal auto-pick rotation AND inject a news-reaction craft rules block into
  // the prompt (see buildPrompt). The 3-takeaway template can still be picked by
  // rotation when appropriate.
  //
  // Also auto-detect news reactions from the topic + context text when the
  // caller didn't pass useNewsTemplate explicitly, chat-mode prompts like
  // "Write a LinkedIn post reacting to: '[Vitalik says X]'" need the hardening
  // block to fire too, otherwise the model produces a bare-headline-recap hook
  // and pads with niche-stamped vague forward-statement closers.
  const isNewsReaction = !!useNewsTemplate
    || looksLikeNewsReaction(topic)
    || looksLikeNewsReaction(context);
  let templateId = rawTemplateId;
  // Auto-pick a template:
  //  - Twitter only:  requires explicit `useTemplate: true` (existing behaviour, raw is the default for X)
  //  - LinkedIn (or 'both'): ALWAYS picks a long-post template unless caller explicitly passes useTemplate=false.
  //    Every LinkedIn post should follow one of the 6 seeded patterns (rotated), creatively varied.
  const shouldAutoPick = !templateId && brand?.id && useTemplate !== false && (
    useTemplate === true ||
    targetPlatform === 'linkedin' ||
    targetPlatform === 'both'
  );

  if (shouldAutoPick && brand?.id) {
    // Exclude templates used by this brand in the last 60 days so the rotation feels fresh
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const recentlyUsed = await db
      .select({ templateId: templateUsage.templateId })
      .from(templateUsage)
      .where(and(eq(templateUsage.brandId, brand.id), gte(templateUsage.createdAt, since)));
    const usedIds = recentlyUsed.map(r => r.templateId);

    // Brand flag for satirical eligibility
    const [brandFlags] = await db
      .select({ allowUnhingedMode: brands.allowUnhingedMode })
      .from(brands)
      .where(eq(brands.id, brand.id))
      .limit(1);

    const candidates = await db
      .select({ id: postPatterns.id, contentCategory: postPatterns.contentCategory, postType: postPatterns.postType })
      .from(postPatterns)
      .where(and(
        eq(postPatterns.isActive, true),
        usedIds.length > 0 ? notInArray(postPatterns.id, usedIds) : undefined,
      ))
      .limit(40);

    // Filter to platform-matching post types + opted-in templates only
    const eligible = candidates
      .filter(c => isAutoRotationEligible(c.contentCategory, brandFlags?.allowUnhingedMode))
      .filter(c => {
        if (targetPlatform === 'twitter') return c.postType === 'tweet' || c.postType === 'thread';
        if (targetPlatform === 'linkedin') return c.postType === 'long-post';
        // 'both': prefer long-post since LinkedIn benefits more from structure;
        // Twitter side will get standard rules due to the template-platform safety check.
        const linkedinPool = candidates.filter(x => x.postType === 'long-post' && isAutoRotationEligible(x.contentCategory, brandFlags?.allowUnhingedMode));
        return linkedinPool.length > 0 ? c.postType === 'long-post' : true;
      });

    if (eligible.length > 0) {
      templateId = eligible[Math.floor(Math.random() * eligible.length)].id;
    }
  }

  // Fetch full pattern from DB if a templateId was provided
  let fullPattern: FullPattern | undefined;
  if (templateId) {
    const [row] = await db
      .select({
        id: postPatterns.id,
        name: postPatterns.name,
        template: postPatterns.template,
        example: postPatterns.example,
        hookType: postPatterns.hookType,
        formatType: postPatterns.formatType,
        bodyStructure: postPatterns.bodyStructure,
        closerType: postPatterns.closerType,
        engagementTarget: postPatterns.engagementTarget,
        coreInsight: postPatterns.coreInsight,
        viralMechanic: postPatterns.viralMechanic,
        emotionTrigger: postPatterns.emotionTrigger,
        postType: postPatterns.postType,
      })
      .from(postPatterns)
      .where(eq(postPatterns.id, templateId))
      .limit(1);
    if (row) fullPattern = row;
  }

  const prompt = buildPrompt({ topic, context: mergedContext, voiceGuide, brandName, guide, chat, directWrite, pattern: fullPattern, recentPostsContext, history, contentStyle: brand?.contentStyle, platform: targetPlatform, isNewsReaction, brandNiche: brand?.niche ?? null });

  // ── callAI: refund on failure ─────────────────────────────────────────────────
  let text: string;
  try {
    text = await callAI({ model: MODEL_CREATIVE, prompt, temperature: 0.8, maxTokens: 2000 });
  } catch (err) {
    console.error('[generate] callAI failed', userId, err);
    if (chat) await refundCredits(userId, 'chat_message', { reason: 'callAI_error' });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  // ── parseJSON: refund on failure ──────────────────────────────────────────────
  const parsed = parseJSON<Record<string, string>>(text);
  if (!parsed) {
    console.error('[generate] parseJSON returned null', userId);
    if (chat) await refundCredits(userId, 'chat_message', { reason: 'parse_failure' });
    return NextResponse.json({ error: 'Failed to parse generation output' }, { status: 500 });
  }

  try {
    // Record template usage so the same template isn't repeated for this brand
    if (templateId && fullPattern && brand?.id) {
      await db.insert(templateUsage).values({ brandId: brand.id, templateId }).catch(() => {});
    }

    if (chat) {
      if (parsed.type === 'info') {
        return NextResponse.json({ type: 'info', text: parsed.text ?? '' });
      }
      if (parsed.type === 'question') {
        return NextResponse.json({ type: 'question', text: parsed.text ?? '' });
      }
      // AI asked for news worth posting → pull top scored mainstream items for this brand
      if (parsed.type === 'news_lookup') {
        if (!brand?.id) {
          return NextResponse.json({
            type: 'info',
            text: "I'd need an active brand to know which news is worth posting. Set one up in Settings first.",
          });
        }
        // Refund the chat_message credit, the user got research, not generation
        await refundCredits(userId, 'chat_message', { reason: 'news_lookup' }).catch(() => {});

        // Check brand opt-in
        const [brandFlag] = await db
          .select({ enabled: brands.mainstreamNewsEnabled })
          .from(brands)
          .where(eq(brands.id, brand.id))
          .limit(1);
        if (!brandFlag?.enabled) {
          return NextResponse.json({
            type: 'info',
            text: "Mainstream news pulse is off for this brand. Turn it on in Settings → Mainstream news, and I'll surface news worth posting on the next refresh.",
          });
        }

        try {
          const { getTopScoredNewsForBrand } = await import('@/lib/score-news-for-brand');
          const items = await getTopScoredNewsForBrand(brand.id, 5, 4);
          if (items.length === 0) {
            return NextResponse.json({
              type: 'info',
              text: "No news is scored high enough for your brand right now. The cron fetches every 3 hours — fresh items should show up soon. Try again in a bit, or open the board to see what's already in your pulse.",
            });
          }
          const lines = items.map((n, i) => {
            const src = `${n.source}`;
            const angle = n.suggestedAngle ? `\n   Angle: ${n.suggestedAngle}` : '';
            return `${i + 1}. ${n.title} (${src})${angle}\n   ${n.url}`;
          });
          return NextResponse.json({
            type: 'info',
            text: `Top news worth posting right now:\n\n${lines.join('\n\n')}\n\nPick one and paste its URL or headline back to me, or click the matching card in Today's Pulse on your board to generate a LinkedIn post.`,
          });
        } catch (err) {
          console.error('[news_lookup] fetch failed:', err instanceof Error ? err.message : err);
          return NextResponse.json({
            type: 'info',
            text: "Couldn't fetch news right now. Try again in a moment.",
          });
        }
      }

      // AI detected a Twitter lookup the server-side regex missed
      if (parsed.type === 'twitter_lookup' && (await xAvailable())) {
        try {
          let resultText = '';
          const intent = parsed.intent as string;
          if (intent === 'tweet_url' && parsed.tweetUrl) {
            const id = extractTweetId(parsed.tweetUrl as string);
            if (id) {
              const tweet = await fetchTweetById(id);
              resultText = tweet ? formatSingleTweet(tweet) : 'That tweet is either deleted or from a protected account.';
            } else {
              resultText = "Couldn't parse that tweet URL.";
            }
          } else if (intent === 'profile' && parsed.handle) {
            const tweets = await fetchUserTweets(parsed.handle as string, 10);
            resultText = formatTweetsText(tweets, `@${(parsed.handle as string).replace(/^@/, '')}`);
          } else {
            const q = (parsed.query as string) || topic;
            const tweets = await searchTweets(q, 10);
            resultText = formatTweetsText(tweets);
          }
          return NextResponse.json({ type: 'info', text: resultText });
        } catch {
          return NextResponse.json({
            type: 'info',
            text: "Twitter lookup hit a snag — try again in a moment.",
          });
        }
      }
      // Pass 2: fix rule violations in parallel (failures here are non-fatal).
      // Skip the platform we didn't ask for so we don't burn judge calls on empty strings.
      const wantTwitter = targetPlatform === 'twitter' || targetPlatform === 'both';
      const wantLinkedin = targetPlatform === 'linkedin' || targetPlatform === 'both';
      const judgeOpts = { userId, niche: brand?.niche ?? null, isNewsReaction };
      const [twitterFixed, linkedinFixed] = await Promise.all([
        wantTwitter ? applyRulesFix(parsed.twitter ?? '', judgeOpts) : Promise.resolve(''),
        wantLinkedin ? applyRulesFix(parsed.linkedin ?? '', judgeOpts) : Promise.resolve(''),
      ]);
      // Always enforce \n\n separation on Twitter output, even when a LinkedIn
      // long-post template auto-picked, the Twitter side still needs hook/body/closer
      // block separators. Previously gated on !fullPattern which let Twitter slip
      // through unbroken whenever a LinkedIn template was selected.
      const twitter = wantTwitter ? stripEmDashes(enforceTwitterBreaks(twitterFixed)) : '';
      // Additional charge for actual post generation in chat (non-fatal if it fails)
      await deductCredits(userId, 'chat_generate').catch(() => {});
      const recommendedVisual = vaultStrategy?.visuals[0]?.asset;
      return NextResponse.json({
        type: 'posts',
        ...(wantTwitter ? { twitter } : {}),
        ...(wantLinkedin ? { linkedin: stripEmDashes(linkedinFixed) } : {}),
        ...(recommendedVisual ? {
          imageUrl: recommendedVisual.fileUrl,
          recommendedImage: {
            id: recommendedVisual.id,
            url: recommendedVisual.fileUrl,
            filename: recommendedVisual.originalFilename,
            reason: vaultStrategy?.visuals[0]?.reason ?? 'vault-match',
            caption: recommendedVisual.captionSummary,
            source: 'vault' as const,
          },
        } : {}),
        ...(draftSourceInputs.length ? { sourceInputs: draftSourceInputs } : {}),
      });
    }

    // Pass 2: fix rule violations in parallel (failures here are non-fatal)
    const wantTwitter = targetPlatform === 'twitter' || targetPlatform === 'both';
    const wantLinkedin = targetPlatform === 'linkedin' || targetPlatform === 'both';
    const judgeOpts = { userId, niche: brand?.niche ?? null, isNewsReaction };
    const [twitterFixed, linkedinFixed] = await Promise.all([
      wantTwitter ? applyRulesFix(parsed.twitter ?? '', judgeOpts) : Promise.resolve(''),
      wantLinkedin ? applyRulesFix(parsed.linkedin ?? '', judgeOpts) : Promise.resolve(''),
    ]);
    const twitter = stripEmDashes(!fullPattern && wantTwitter ? enforceTwitterBreaks(twitterFixed) : twitterFixed);
    if (!chat) recordDailyAction(userId, 'generate').catch(() => {});
    const recommendedVisual = vaultStrategy?.visuals[0]?.asset;
    return NextResponse.json({
      ...(wantTwitter ? { twitter } : {}),
      ...(wantLinkedin ? { linkedin: stripEmDashes(linkedinFixed) } : {}),
      ...(recommendedVisual ? {
        imageUrl: recommendedVisual.fileUrl,
        recommendedImage: {
          id: recommendedVisual.id,
          url: recommendedVisual.fileUrl,
          filename: recommendedVisual.originalFilename,
          reason: vaultStrategy?.visuals[0]?.reason ?? 'vault-match',
          caption: recommendedVisual.captionSummary,
          source: 'vault' as const,
        },
      } : {}),
      ...(draftSourceInputs.length ? { sourceInputs: draftSourceInputs } : {}),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
