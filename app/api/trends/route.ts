import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands, creditTransactions, drafts } from '@/lib/db/schema';
import { eq, and, gte, sql, notInArray, desc } from 'drizzle-orm';
import { callAI, MODEL_EXTRACT, MODEL_CREATIVE, parseJSON } from '@/lib/ai';
import { STRUCTURAL_RULES } from '@/lib/global-rules';
import { SHORT_TEXT_BANS } from '@/lib/craft-rules';
import { loadVoiceContext, formatVoiceSection } from '@/lib/voice-context';
import { deductCredits } from '@/lib/credits';

export interface SourceTweet {
  id: string;
  text: string;
  author: string;
  authorHandle: string;
  likeCount: number;
  url: string;
}

export interface Trend {
  id: string;
  headline: string;
  context: string;
  angle: string;
  type?: 'idea' | 'qrt' | 'mainstream';
  sourceTweet?: SourceTweet;
  // For mainstream news cards: the article source + URL so the UI can link out
  mainstream?: {
    source: string;
    url: string;
    publishedAt: string | null;
  };
}

// Max trend refreshes per day. Cheap (Gemini Flash) but prevents abuse.
const DAILY_TRENDS_LIMIT = 5;

// Pull top viral tweets from the last 24h for a given niche query
type RawViralTweet = {
  id?: string;
  text?: string;
  likeCount?: number;
  author?: { name?: string; userName?: string };
};

async function twitterSearch(query: string, key: string): Promise<RawViralTweet[]> {
  const params = new URLSearchParams({ query, queryType: 'Top' });
  const res = await fetch(`https://api.twitterapi.io/twitter/tweet/advanced_search?${params}`, {
    headers: { 'x-api-key': key },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    console.error('[trends/qrt] twitterapi.io error:', res.status, query.slice(0, 80));
    return [];
  }
  const data = await res.json() as { tweets?: RawViralTweet[]; error?: string };
  if (data.error) console.error('[trends/qrt] api error:', data.error);
  return data.tweets ?? [];
}

// Patterns that signal a tweet is NOT worth quote-tweeting:
//  - AI-prompt tweets ("Hey @grok ...", "@grok explain ...", "@perplexity ...")
//  - Pure reply tweets (the kind that only make sense if you saw the parent)
//  - Promo/giveaway noise
const NOISE_PATTERNS = [
  /^\s*@grok\b/i,
  /^\s*hey\s+@grok\b/i,
  /^\s*@perplexity\b/i,
  /^\s*@askperplexity\b/i,
  /^\s*@elonmusk[\s,?!]/i, // pleas to Elon, not opinions
  /^\s*rt\s+@/i,
  /\bgiveaway\b/i,
  /\bairdrop\b.*\b(claim|free|sign up)\b/i,
  /\b(follow|rt|retweet)\s+(to|and)\s+(win|enter)\b/i,
];

function isQualityTweet(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 60) return false;                  // too short to be a real take
  if (/^@\w+\s/.test(t)) return false;              // starts with a reply mention
  if (NOISE_PATTERNS.some(rx => rx.test(t))) return false;
  // Mostly URL / mostly emoji junk
  const urlCount = (t.match(/https?:\/\//g) ?? []).length;
  if (urlCount >= 2) return false;
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (wordCount < 12) return false;
  return true;
}

async function fetchViralTweets(nicheQuery: string): Promise<SourceTweet[]> {
  const key = process.env.TWITTERAPI_IO_KEY;
  if (!key) {
    console.error('[trends/qrt] TWITTERAPI_IO_KEY not set');
    return [];
  }

  const since24h = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
  console.log('[trends/qrt] searching:', nicheQuery);

  // Server-side exclusions reduce the noise we get back
  const exclusions = '-@grok -@perplexity -@askperplexity -filter:replies -filter:retweets';

  try {
    let raw = await twitterSearch(
      `${nicheQuery} min_faves:100 ${exclusions} lang:en since_time:${since24h}`,
      key,
    );
    console.log('[trends/qrt] min_faves:100 →', raw.length, 'tweets');

    if (raw.length === 0) {
      raw = await twitterSearch(
        `${nicheQuery} min_faves:20 ${exclusions} lang:en since_time:${since24h}`,
        key,
      );
      console.log('[trends/qrt] min_faves:20 →', raw.length, 'tweets');
    }

    return raw
      .filter(t => t.id && t.text && t.author?.userName)
      .filter(t => isQualityTweet(t.text!))
      .slice(0, 12)
      .map(t => ({
        id: t.id!,
        text: t.text!,
        author: t.author?.name ?? t.author?.userName ?? '',
        authorHandle: t.author?.userName ?? '',
        likeCount: t.likeCount ?? 0,
        url: `https://x.com/${t.author?.userName}/status/${t.id}`,
      }));
  } catch (err) {
    console.error('[trends/qrt] exception:', err instanceof Error ? err.message : err);
    return [];
  }
}

// Build a Twitter search query from niche + pillars.
// Extracts adjacent word pairs (bigrams) from each source phrase and quotes them for exact matching.
// Quoted bigrams avoid generic single-word noise (e.g. "vibe coding" vs just "coding").
// Pillars processed first since they're usually more specific than the niche description.
function nicheToSearchQuery(niche: string, pillars?: string): string {
  const stopWords = new Set([
    'and','the','for','with','from','that','this','your','about','how','into',
    'first','based','using','make','build','more','when','what','where','they',
    'have','been','will','their','which','only','real','also','just','most',
    'some','very','like','than','then','over','after','since','between','once',
    'each','both','many','much','such','same','even','back','next','last',
  ]);

  // Too generic for Twitter search, produces unrelated noise as quoted phrase components
  const genericWords = new Set([
    'product','strategy','design','impact','growth','content','approach',
    'actual','problem','client','process','people','things','building',
    'system','model','business','company','industry','market',
    'journey','story','lesson','example','better','good','best','great',
    'hard','easy','right','wrong','need','work','time','data','team',
    'revenue','value','power','world','life','help','lead','show','give',
    'take','traditional','critiques','gaming','personal','fortune',
  ]);

  const phrases: string[] = [];
  const seenNorm = new Set<string>();

  const pillarList = pillars ? pillars.split(',').map(p => p.trim()) : [];
  const nicheTopics = niche ? niche.split(',').map(t => t.trim()) : [];

  for (const source of [...pillarList, ...nicheTopics]) {
    const words = source
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3);

    for (let i = 0; i < words.length - 1; i++) {
      const a = words[i];
      const b = words[i + 1];
      if (
        a.length >= 4 && b.length >= 4 &&
        !stopWords.has(a) && !stopWords.has(b) &&
        !genericWords.has(a) && !genericWords.has(b)
      ) {
        // Deduplicate singular/plural variants ("venture studio" vs "venture studios")
        const norm = `${a.replace(/s$/, '')} ${b.replace(/s$/, '')}`;
        if (!seenNorm.has(norm)) {
          seenNorm.add(norm);
          phrases.push(`"${a} ${b}"`);
        }
      }
    }
  }

  if (phrases.length >= 2) return phrases.slice(0, 3).join(' OR ');
  if (phrases.length === 1) return phrases[0];

  // Fallback: individual long distinctive words
  const allText = `${niche} ${pillars ?? ''}`;
  const fallbackWords = allText
    .toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 7 && !stopWords.has(w) && !genericWords.has(w));
  const uniqueFallback = [...new Set(fallbackWords)].slice(0, 2);
  return uniqueFallback.length > 0 ? uniqueFallback.join(' OR ') : 'startup founder';
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 500 });
  }

  // ── Daily cap: 5 refreshes per user per day ──────────────────────────────────
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.userId, userId),
        eq(creditTransactions.action, 'trends_refresh'),
        gte(creditTransactions.createdAt, todayStart),
      ),
    );

  const usedToday = countRow?.count ?? 0;
  if (usedToday >= DAILY_TRENDS_LIMIT) {
    return NextResponse.json(
      { error: 'Daily trend refresh limit reached', used: usedToday, limit: DAILY_TRENDS_LIMIT, type: 'daily_limit_reached' },
      { status: 429 },
    );
  }

  // ── Deduct 1 credit ──────────────────────────────────────────────────────────
  const { ok, balance, required } = await deductCredits(userId, 'trends_refresh');
  if (!ok) {
    return NextResponse.json(
      { error: 'Out of credits', balance, required, type: 'insufficient_credits' },
      { status: 402 },
    );
  }

  const [brand] = await db
    .select({
      id: brands.id,
      niche: brands.niche,
      contentPillars: brands.contentPillars,
      handle: brands.handle,
      name: brands.name,
      voiceSummary: brands.voiceSummary,
      briefMd: brands.briefMd,
      mainstreamNewsEnabled: brands.mainstreamNewsEnabled,
    })
    .from(brands)
    .where(and(eq(brands.userId, userId), eq(brands.isActive, true)))
    .orderBy(desc(brands.createdAt))
    .limit(1);

  // ── Fetch existing drafts to avoid duplicating what's already in the pipeline ─
  const existingDraftRows = brand?.id
    ? await db
        .select({ content: drafts.content })
        .from(drafts)
        .where(and(
          eq(drafts.brandId, brand.id),
          notInArray(drafts.status, ['posted', 'scored']),
        ))
        .orderBy(desc(drafts.createdAt))
        .limit(20)
    : [];

  const existingHooks = existingDraftRows
    .map(d => d.content.split('\n')[0].slice(0, 100).trim())
    .filter(Boolean);

  // ── 3-pass voice context ─────────────────────────────────────────────────────
  const voiceCtx = brand?.id ? await loadVoiceContext(brand.id) : { pass2: '', pass3: '' };
  const voiceGuide = formatVoiceSection(voiceCtx);

  // Detect what profile info is missing, used to nudge user to fill in their profile
  const missingFields: { field: string; label: string; why: string }[] = [];
  if (!brand?.niche) missingFields.push({ field: 'niche', label: 'Your niche', why: 'trends will be generic without it' });
  if (!brand?.contentPillars || (brand.contentPillars as string[]).filter(Boolean).length === 0)
    missingFields.push({ field: 'contentPillars', label: 'Content pillars', why: 'helps match trends to your topics' });
  if (!brand?.handle) missingFields.push({ field: 'handle', label: 'Twitter handle', why: 'lets us tailor to your existing audience' });

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const niche = brand?.niche ?? 'business and entrepreneurship';
  const pillars = (brand?.contentPillars as string[] | undefined)?.filter(Boolean).join(', ');
  const handle = brand?.handle ? `@${brand.handle}` : null;
  const voiceSummary = brand?.voiceSummary ?? null;

  const contextLines = [
    pillars ? `Content pillars: ${pillars}` : null,
    handle ? `Twitter handle: ${handle}` : null,
    voiceSummary ? `Voice/style: ${voiceSummary.slice(0, 200)}` : null,
  ].filter(Boolean).join('\n');

  const avoidSection = existingHooks.length > 0
    ? `\nAvoid topics too similar to these drafts already in the pipeline:\n${existingHooks.map(h => `- "${h}"`).join('\n')}\n`
    : '';

  // ── Fetch viral tweets FIRST so we can ground the AI in real content ────────
  const nicheQuery = nicheToSearchQuery(niche, pillars);
  const viralTweets = await fetchViralTweets(nicheQuery);

  // Build the evidence block: top 10 real viral tweets the AI will read
  const evidenceBlock = viralTweets.length > 0
    ? `## Real viral tweets from the "${niche}" space in the last 24 hours
These are the actual posts getting traction RIGHT NOW. Read them, then extract 3 conversation angles that emerge from this data — patterns, debates, counterintuitive observations.

${viralTweets.slice(0, 10).map((t, i) => `${i + 1}. [${t.likeCount.toLocaleString()} likes · @${t.authorHandle}]\n   "${t.text.replace(/\n+/g, ' ').slice(0, 240)}"`).join('\n\n')}`
    : `(No viral tweets fetched — generate generic timely topics in the "${niche}" space.)`;

  const prompt = `Today is ${today}.

${STRUCTURAL_RULES}

${evidenceBlock}
${contextLines ? `\n## Context about this creator\n${contextLines}\n` : ''}${avoidSection}${voiceGuide ? `\n${voiceGuide}\n` : ''}

## Hard rules — read these before writing
- Do NOT invent dates, years, market conditions, or "this cycle / mid-2025 / right now" framing unless those words appear in the source tweets above.
- Do NOT speculate about industry trends you can't see evidence for in the tweets.
- The context field should describe what you observe in the actual tweets — not a market backdrop you're guessing at.
- If the niche is generic and the tweets don't cluster around a clear pattern, return broader angles grounded in the creator's profile instead — but still no invented dates or market commentary.

## Your job
${viralTweets.length > 0
  ? `Surface 3 conversation angles GROUNDED in the viral tweets above. Each angle should reference a real pattern you actually see across the data — not invented. The context line should describe the pattern you see, not market backdrop.`
  : `Surface 3 timely conversation topics for this creator's niche. Keep context lines factual, not speculative.`}

For each angle:
- headline: punchy, specific (max 10 words). No dates or years.
- context: one sentence describing the pattern observed in the tweets. No market commentary, no invented years.
- angle: the content approach that would land best (e.g. "contrarian take", "share a personal story", "break down the data", "hot take", "tactical breakdown")

${SHORT_TEXT_BANS}

Return ONLY valid JSON object with a trends array:
{"trends": [
  { "id": "1", "headline": "...", "context": "...", "angle": "..." },
  { "id": "2", "headline": "...", "context": "...", "angle": "..." },
  { "id": "3", "headline": "...", "context": "...", "angle": "..." }
]}`;

  // ── Now call AI with the real tweets in context ─────────────────────────────
  let aiRaw: string;
  try {
    aiRaw = await callAI({ model: MODEL_CREATIVE, prompt, temperature: 0.65, maxTokens: 700 });
  } catch {
    try {
      aiRaw = await callAI({ model: MODEL_EXTRACT, prompt, temperature: 0.65, maxTokens: 700 });
    } catch {
      aiRaw = '';
    }
  }

  let aiTrends: Trend[] = [];
  if (aiRaw) {
    const parsed = parseJSON<{ trends?: Trend[] } | Trend[]>(aiRaw);
    if (Array.isArray(parsed)) {
      aiTrends = parsed;
    } else if (parsed && 'trends' in parsed && Array.isArray(parsed.trends)) {
      aiTrends = parsed.trends;
    }
  }

  if (aiTrends.length === 0) {
    return NextResponse.json({ error: 'Failed to generate trends' }, { status: 500 });
  }

  // Build QRT cards from the same viral tweets we already fetched
  const qrtTrends: Trend[] = viralTweets.slice(0, 2).map((tweet, i) => ({
    id: `qrt-${i}`,
    headline: tweet.text.split('\n')[0].slice(0, 80),
    context: `${tweet.likeCount.toLocaleString()} likes · @${tweet.authorHandle}`,
    angle: 'QRT reaction',
    type: 'qrt' as const,
    sourceTweet: tweet,
  }));

  // ── Mainstream news cards (LinkedIn pulse), only for opted-in brands ──────
  let mainstreamTrends: Trend[] = [];
  if (brand?.id && brand.mainstreamNewsEnabled) {
    try {
      const { getTopScoredNewsForBrand } = await import('@/lib/score-news-for-brand');
      const newsItems = await getTopScoredNewsForBrand(brand.id, 5, 4);
      mainstreamTrends = newsItems.map((n, i): Trend => ({
        id: `mainstream-${i}-${n.itemId}`,
        headline: n.title,
        context: n.suggestedAngle ?? n.summary?.slice(0, 200) ?? '',
        angle: 'LinkedIn news reaction',
        type: 'mainstream' as const,
        mainstream: {
          source: n.source,
          url: n.url,
          publishedAt: n.publishedAt?.toISOString() ?? null,
        },
      }));
    } catch (err) {
      console.error('[trends] mainstream news fetch failed:', err instanceof Error ? err.message : err);
    }
  }

  // Interleave: QRT first (timely X content), then grounded AI angles, then mainstream news (LinkedIn-focused)
  const combined: Trend[] = [
    ...qrtTrends,
    ...aiTrends.map(t => ({ ...t, type: 'idea' as const })),
    ...mainstreamTrends,
  ];

  return NextResponse.json({
    trends: combined,
    remaining: DAILY_TRENDS_LIMIT - usedToday - 1,
    missingInfo: missingFields.length > 0 ? missingFields : undefined,
  });
}
