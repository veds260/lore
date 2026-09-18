import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { brands, ownPosts, brandVoiceHistory } from '@/lib/db/schema';
import { callAI, MODEL_CREATIVE } from '@/lib/ai';
import { NO_X_ACCESS, syncBrandTweets } from '@/lib/sync-brand-tweets';
import { xAvailable } from '@/lib/twitterapi';

// Hard formatting rules every brand voice must enforce.
const BANNED_PATTERNS = `### Universal Rules (hard — never break)
- No em dashes (—) anywhere. Use a comma, period, or rewrite.
- No rhetorical questions ("The truth?", "Want to know why?").
- Never the "didn't X. they Y." pattern (e.g. "they didn't pick the right one. they built something real.").
- Never the "X isn't Y. It's Z." reversal pattern.
- No same/same staccato ("Same X. Same Y. Same Z.").
- No generic motivational filler ("your network is your net worth").
- Plain words over fancy ones. Write the way this person actually talks.`;

export interface BootstrapResult {
  ok: boolean;
  reason?: string;
  sampleCount?: number;
  synced?: number;
}

// Build a brand's voice document from its real tweets. Fills the gap where the weekly skill
// consolidation produces nothing for a brand that has no accumulated corrections/skills yet;
// it learns the voice straight from how the person already writes. Idempotent: skips a brand
// that already has a voice document unless `force` is set (force archives the old one first).
export async function bootstrapVoiceFromPosts(
  brandId: string,
  opts: { force?: boolean } = {},
): Promise<BootstrapResult> {
  const [brand] = await db
    .select({ id: brands.id, handle: brands.handle, niche: brands.niche, styleGuideMd: brands.styleGuideMd, voiceDocument: brands.voiceDocument })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) return { ok: false, reason: 'brand not found' };
  if (brand.voiceDocument && !opts.force) return { ok: false, reason: 'voice document already exists' };
  if (!brand.handle) return { ok: false, reason: 'brand has no twitter handle' };

  const countTweets = async () => {
    const [r] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ownPosts)
      .where(and(eq(ownPosts.brandId, brandId), eq(ownPosts.platform, 'twitter')));
    return r?.count ?? 0;
  };

  // Make sure we have real tweets to learn from; backfill 6 months on first run.
  let synced = 0;
  if ((await countTweets()) === 0) {
    synced = await syncBrandTweets(brandId, brand.handle);
  }
  if ((await countTweets()) === 0) {
    // Nothing to learn from splits two ways, and only one of them is fixable by
    // the person reading the reason.
    const reason = (await xAvailable()) ? 'no tweets available to learn from' : NO_X_ACCESS;
    console.warn(`[bootstrapVoice] brand ${brandId}: ${reason}`);
    return { ok: false, reason, synced };
  }

  // ORIGINAL posts only, never learn voice from replies (reactive/conversational) or retweets.
  // The reply/RT exclusion runs IN SQL so the limit captures originals; otherwise a heavy replier's
  // most-recent rows are all replies and nothing survives the filter. Replies lead with @mentions.
  const rows = await db
    .select({ content: ownPosts.content, likeCount: ownPosts.likeCount })
    .from(ownPosts)
    .where(and(
      eq(ownPosts.brandId, brandId),
      eq(ownPosts.platform, 'twitter'),
      sql`char_length(${ownPosts.content}) >= 30`,
      sql`${ownPosts.content} not ilike '@%'`,
      sql`${ownPosts.content} not ilike 'RT @%'`,
    ))
    .orderBy(desc(ownPosts.postedAt))
    .limit(120);

  const samples = rows.map((r) => r.content.trim()).filter((t) => !/^@\w/.test(t)).slice(0, 80);
  if (samples.length < 5) return { ok: false, reason: 'not enough usable tweets to learn from', synced };

  const numbered = samples.map((t, i) => `${i + 1}. ${t.replace(/\s+/g, ' ')}`).join('\n');

  const prompt = `You are writing the living voice document for a content creator's brand. It is injected into every AI draft, so it must capture how THIS person actually writes — not generic best practices.

Study these ${samples.length} real posts from @${brand.handle}${brand.niche ? ` (niche: ${brand.niche})` : ''}:

${numbered}
${brand.styleGuideMd ? `\n## Manual style guide (written by the creator — these rules take precedence)\n${brand.styleGuideMd}\n` : ''}
From the posts, infer and document their real voice. Produce a Markdown voice document with these sections:

### Voice & Tone
How they sound (casual/formal, warm/sharp, confident/humble). Quote 2-4 of their actual recurring phrases or words.

### Structure
How they build a post: hook style, line breaks, length, how they open and how they close. Note their real patterns from the posts above.

### Topics & Angles
What they post about and the angle they take (e.g. behind-the-scenes builder, contrarian, data-led).

### Platform Rules
#### Twitter/X
Concrete do/don'ts derived from the posts.

${BANNED_PATTERNS}

Rules:
- Describe the voice in the posts, do not invent traits not evidenced there.
- If a manual style guide exists, its rules win and lead the relevant section.
- Keep the whole document under 2200 tokens.
- Return ONLY the Markdown document, no preamble.`;

  const newDoc = await callAI({ model: MODEL_CREATIVE, prompt, temperature: 0.3, maxTokens: 2500 });
  if (!newDoc?.trim()) return { ok: false, reason: 'synthesis returned empty', synced };

  // Archive an existing doc only when force-overwriting (fill-empty path has nothing to archive).
  if (brand.voiceDocument) {
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(brandVoiceHistory)
      .where(eq(brandVoiceHistory.brandId, brandId));
    await db.insert(brandVoiceHistory).values({
      brandId,
      voiceDocument: brand.voiceDocument,
      version: (countRow?.count ?? 0) + 1,
      triggeredBy: 'init',
      skillsIncluded: 0,
    });
  }

  await db
    .update(brands)
    .set({ voiceDocument: newDoc.trim(), voiceDocumentUpdatedAt: new Date(), voiceSamples: JSON.stringify(samples) })
    .where(eq(brands.id, brandId));

  return { ok: true, sampleCount: samples.length, synced };
}

// Build the voice document from posts supplied as plain text. Always replaces the current
// doc (explicit rebuild from a curated corpus); archives the previous version.
export async function bootstrapVoiceFromTexts(
  brandId: string,
  texts: string[],
): Promise<BootstrapResult> {
  const [brand] = await db
    .select({ id: brands.id, handle: brands.handle, niche: brands.niche, styleGuideMd: brands.styleGuideMd, voiceDocument: brands.voiceDocument })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) return { ok: false, reason: 'brand not found' };

  // Each post may be a thread joined by the \n\n\n separator; keep the whole post as one
  // sample (the thread is one authored unit). Drop empties and trivially short ones.
  const seen = new Set<string>();
  const samples = texts
    .map((t) => (t || '').trim())
    .filter((t) => t.length >= 20 && !seen.has(t) && (seen.add(t), true))
    .slice(0, 80);
  if (samples.length < 3) return { ok: false, reason: 'not enough portal posts to learn from' };

  const numbered = samples.map((t, i) => `${i + 1}. ${t.replace(/\s+/g, ' ')}`).join('\n');
  const prompt = `You are writing the living voice document for ${brand.handle ? '@' + brand.handle : "a creator"}'s brand. It is injected into every AI draft, so it must capture EXACTLY how this brand writes.

These are the posts the brand is publishing RIGHT NOW — its current, intended voice. Match these precisely; ignore any older or different style.${brand.niche ? ` Niche: ${brand.niche}.` : ''}

${numbered}
${brand.styleGuideMd ? `\n## Manual style guide (written by the creator — these rules take precedence)\n${brand.styleGuideMd}\n` : ''}
From these posts, infer and document the voice. Produce a Markdown voice document with these sections:

### Voice & Tone
How they sound. Quote 2-4 actual recurring phrases or words from the posts above.

### Structure
How they build a post: hook style, line breaks, length, capitalization, how they open and close. Use the real patterns above.

### Topics & Angles
What they post about and the angle (e.g. personal story, contrarian money take, lesson from experience).

### Platform Rules
#### Twitter/X
Concrete do/don'ts derived from the posts.

${BANNED_PATTERNS}

Rules:
- Describe the voice in THESE posts only; do not invent traits not evidenced here.
- If a manual style guide exists, its rules win and lead the relevant section.
- Keep the whole document under 2200 tokens.
- Return ONLY the Markdown document, no preamble.`;

  const newDoc = await callAI({ model: MODEL_CREATIVE, prompt, temperature: 0.3, maxTokens: 2500 });
  if (!newDoc?.trim()) return { ok: false, reason: 'synthesis returned empty' };

  if (brand.voiceDocument) {
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(brandVoiceHistory)
      .where(eq(brandVoiceHistory.brandId, brandId));
    await db.insert(brandVoiceHistory).values({
      brandId,
      voiceDocument: brand.voiceDocument,
      version: (countRow?.count ?? 0) + 1,
      triggeredBy: 'init',
      skillsIncluded: 0,
    });
  }

  await db
    .update(brands)
    .set({ voiceDocument: newDoc.trim(), voiceDocumentUpdatedAt: new Date(), voiceSamples: JSON.stringify(samples) })
    .where(eq(brands.id, brandId));

  return { ok: true, sampleCount: samples.length };
}
