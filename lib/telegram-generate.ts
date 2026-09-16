import { and, eq, notInArray, gte } from 'drizzle-orm';
import { db } from './db';
import { brands, postPatterns, templateUsage } from './db/schema';
import { callAI, MODEL_CREATIVE } from './ai';
import { GLOBAL_RULES_PROMPT, STRUCTURAL_RULES } from './global-rules';
import { buildCraftRules, looksLikeNewsReaction } from './craft-rules';
import { applyRulesFix } from './rules-fixer';
import { loadVoiceContext, formatVoiceSection } from './voice-context';
import { isAutoRotationEligible } from './pattern-categories';

// Pick a LinkedIn (long-post) template for this brand, rotated to avoid recent
// repeats, satirical excluded unless brand opted in. Returns null if no eligible
// template exists (shouldn't happen, we always have 5+ seeded).
async function pickLinkedinTemplate(brandId: string): Promise<{ name: string; template: string; example: string | null } | null> {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const [brandFlags] = await db
    .select({ allowUnhingedMode: brands.allowUnhingedMode })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  const recentlyUsed = await db
    .select({ templateId: templateUsage.templateId })
    .from(templateUsage)
    .where(and(eq(templateUsage.brandId, brandId), gte(templateUsage.createdAt, since)));
  const usedIds = recentlyUsed.map(r => r.templateId);

  const candidates = await db
    .select({
      id: postPatterns.id,
      name: postPatterns.name,
      template: postPatterns.template,
      example: postPatterns.example,
      contentCategory: postPatterns.contentCategory,
    })
    .from(postPatterns)
    .where(and(
      eq(postPatterns.isActive, true),
      eq(postPatterns.postType, 'long-post'),
      usedIds.length > 0 ? notInArray(postPatterns.id, usedIds) : undefined,
    ))
    .limit(20);

  const eligible = candidates.filter(c => isAutoRotationEligible(c.contentCategory, brandFlags?.allowUnhingedMode));
  if (eligible.length === 0) return null;
  const pick = eligible[Math.floor(Math.random() * eligible.length)];

  // Record usage so the next pick rotates
  await db.insert(templateUsage).values({ brandId, templateId: pick.id }).catch(() => {});

  return { name: pick.name, template: pick.template, example: pick.example };
}

// Minimal post generator used by the Telegram webhook reply path.
// Generates an X post + LinkedIn post pair from a topic, in the brand's voice.
// Skips credit checks (Telegram users are paid) and skill selection (just uses voiceDocument).
export async function quickGenerate(
  brandId: string,
  topic: string,
  opts?: { userId?: string; platform?: 'twitter' | 'linkedin' | 'both' },
): Promise<{ twitter: string; linkedin: string; templateName?: string } | null> {
  const platform = opts?.platform ?? 'both';
  const [brand] = await db
    .select({
      voiceDocument: brands.voiceDocument,
      briefMd: brands.briefMd,
      styleGuideMd: brands.styleGuideMd,
      name: brands.name,
      niche: brands.niche,
    })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);

  if (!brand) return null;

  // Cap each section so a huge briefMd/styleGuide doesn't drown the topic
  const voice = [
    brand.voiceDocument?.slice(0, 2500),
    brand.briefMd?.slice(0, 2500),
    brand.styleGuideMd?.slice(0, 2000),
  ].filter(Boolean).join('\n\n---\n\n');

  // Load the same skill + correction layer the board / chat / revise paths use.
  // This closes the learning loop: when a user revises a draft anywhere and a
  // skill gets extracted, that rule lands here too, so Telegram drafts pick up
  // the same evolving voice in real time, not weeks later via voice-doc sync.
  const voiceCtx = await loadVoiceContext(brandId);
  const voiceLayer = formatVoiceSection(voiceCtx);

  // For any LinkedIn output, pull a rotated template so the post follows one of
  // the 6 seeded patterns (story → insight, structured arrow, news reaction, etc.)
  // instead of free-form prose.
  const liTemplate = (platform === 'linkedin' || platform === 'both')
    ? await pickLinkedinTemplate(brandId)
    : null;

  const templateBlock = liTemplate ? `

## LinkedIn structural template — follow this pattern creatively
Template name: ${liTemplate.name}

\`\`\`
${liTemplate.template}
\`\`\`

${liTemplate.example ? `### Reference post (same pattern, different topic)
Match the structural beats, sentence rhythm, line density, and closer energy of this reference. Do NOT copy its words or topic.

${liTemplate.example}` : ''}

HARD RULES:
- The LinkedIn post MUST follow this template's structural beats — same number of sections, same hook shape, same closer energy.
- Vary the actual words and the angle. Don't be robotic about it. The template is the SHAPE; the voice is yours.
- Single-sentence paragraphs (each sentence on its own line, blank line between) unless the template says otherwise.
- No em dashes. No hashtags. No rhetorical-question hooks. No "isn't X. It's Y." substitution. No "didn't X. they Y." pattern.` : '';

  // Build platform-specific write instruction + output schema
  const writeTask = platform === 'twitter'
    ? `Write ONE X (Twitter) post on that topic. Punchy, specific, no generic openings.`
    : platform === 'linkedin'
    ? `Write ONE LinkedIn post on that topic. LinkedIn-shaped: spacious paragraphs (each sentence on its own line with blank line between), opening hook in 1-2 lines, narrative or framework in the body, sharp aphoristic closer. Not the same as a tweet — longer, more structured. No hashtags. No "As a [title], I..." opener.`
    : `Write ONE X (Twitter) post and ONE LinkedIn post on that topic. Both punchy, specific, no generic openings. Both in the creator's voice but firmly on the stated subject.`;

  const outputSchema = platform === 'twitter'
    ? `{"twitter":"..."}`
    : platform === 'linkedin'
    ? `{"linkedin":"..."}`
    : `{"twitter":"...","linkedin":"..."}`;

  // Auto-detect news reactions from the topic so the same hardening block the
  // board / chat / revise paths get fires here too. Telegram users often paste
  // launch/funding announcements straight in.
  const isNewsReaction = looksLikeNewsReaction(topic);
  const craftRules = buildCraftRules({ brandNiche: brand.niche ?? null, isNewsReaction });

  // Topic FIRST and last so the model anchors to it; voice profile is style-only.
  const prompt = `You are writing social media posts for ${brand.name ?? 'this creator'}.

## THE POST IS ABOUT THIS — nothing else
${topic}

Rules for using the voice profile below:
- Use it for STYLE, TONE, sentence rhythm, and vocabulary only.
- Do NOT borrow the subject matter, examples, or topics from the voice profile.
- If the voice profile is about (e.g.) NFTs and the topic is about content authenticity, write about content authenticity in the NFT-creator's voice — do not write about NFTs.

## Voice profile (style reference only)
${voice || '(no voice profile yet — write in a clear, direct, founder-style tone)'}

${voiceLayer ? `${voiceLayer}\n` : ''}
${STRUCTURAL_RULES}

${GLOBAL_RULES_PROMPT}

${craftRules}
${templateBlock}

## Reminder
The post must be about: ${topic.slice(0, 500)}

${writeTask}

Return ONLY JSON in this exact shape, no other text:
${outputSchema}`;

  try {
    const out = await callAI({
      model: MODEL_CREATIVE,
      prompt,
      temperature: 0.85,
      maxTokens: 2000,
    });

    // Best-effort JSON parse: strip any markdown fences
    const cleaned = out.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned) as { twitter?: string; linkedin?: string };

    // Need at least the requested platform to be present
    const haveTwitter = !!parsed.twitter;
    const haveLinkedin = !!parsed.linkedin;
    if (platform === 'twitter' && !haveTwitter) return null;
    if (platform === 'linkedin' && !haveLinkedin) return null;
    if (platform === 'both' && !haveTwitter && !haveLinkedin) return null;

    // Run anti-AI pattern fixer (em dashes, jargon, etc.)
    const judgeOpts = { userId: opts?.userId, niche: brand.niche ?? null, isNewsReaction };
    const [twitter, linkedin] = await Promise.all([
      parsed.twitter ? applyRulesFix(parsed.twitter, judgeOpts) : Promise.resolve(''),
      parsed.linkedin ? applyRulesFix(parsed.linkedin, judgeOpts) : Promise.resolve(''),
    ]);

    return { twitter, linkedin, templateName: liTemplate?.name };
  } catch (err) {
    console.error('[quickGenerate] failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
