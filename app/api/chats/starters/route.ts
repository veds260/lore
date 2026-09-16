import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands, brandNewsScores, mainstreamNewsItems } from '@/lib/db/schema';
import { and, desc, eq, gte, isNull, or } from 'drizzle-orm';
import { getActiveBrandId } from '@/lib/active-brand';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todaySeed(): number {
  const d = new Date();
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function rotate<T>(arr: T[], by: number): T[] {
  if (arr.length === 0) return arr;
  const n = ((by % arr.length) + arr.length) % arr.length;
  return [...arr.slice(n), ...arr.slice(0, n)];
}

// Topic-shape gate: returns the cleaned value or null if it looks unusable as
// a post-topic noun phrase. Rules:
//  - 2–60 chars after trim
//  - no question/exclamation marks
//  - no internal sentence punctuation (period, semicolon, double-comma)
//  - doesn't start with an obvious action verb ("ship", "launch", "fix", ...)
//  - doesn't look like a personal/audience descriptor ("helping X", "for Y who")
function asTopicPhrase(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s.length < 2 || s.length > 60) return null;
  if (/[?!]/.test(s)) return null;
  if (/[.;]/.test(s)) return null;
  if (s.split(',').length > 2) return null;
  const lower = s.toLowerCase();
  const actionVerbs = ['ship', 'shipping', 'launch', 'launching', 'finish', 'finishing', 'fix', 'fixing', 'build', 'building', 'send', 'sending', 'write', 'writing', 'record', 'recording', 'release', 'releasing', 'reply'];
  for (const v of actionVerbs) {
    if (lower.startsWith(v + ' ')) return null;
  }
  if (/^(helping|for )\b/.test(lower)) return null;
  if (/\b(who|that)\s/.test(lower) && lower.split(' ').length > 6) return null;
  return s;
}

// Niches like "Web3", "AI tooling", "SaaS founders" pass; "Helping busy SaaS
// founders ship faster" fails. Slightly stricter than asTopicPhrase: short
// length, max 4 words.
function asNicheTag(raw: string | null | undefined): string | null {
  const t = asTopicPhrase(raw);
  if (!t) return null;
  if (t.length > 32) return null;
  if (t.split(' ').length > 4) return null;
  return t;
}

// Clean a news headline:
//  - strip a trailing " | Publication" suffix (pipe, middot, dash variants)
//  - drop trailing punctuation
//  - truncate at last whole word if > 90 chars, append "…"
function cleanHeadline(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  // strip common publication suffixes
  s = s.replace(/\s*[|·–—-]\s*(TechCrunch|The Verge|Hacker News|TechMeme|Bloomberg|Reuters|Wired|Ars Technica|Engadget|VentureBeat)\s*$/i, '');
  s = s.replace(/[.,;:!?]+$/, '');
  if (s.length === 0) return null;
  if (s.length > 90) {
    const cut = s.slice(0, 90);
    const lastSpace = cut.lastIndexOf(' ');
    s = (lastSpace > 60 ? cut.slice(0, lastSpace) : cut) + '…';
  }
  return s;
}

const DEFAULT_STARTERS = [
  'Describe an idea you want to write about',
  'Paste a YouTube video, Reddit thread, or tweet to turn into a post',
  'Share a lesson you learned this week',
  'Paste a draft and ask for a sharper version',
];

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const activeBrandId = await getActiveBrandId(session.user.id);
  if (!activeBrandId) {
    return NextResponse.json({ starters: DEFAULT_STARTERS, personalized: false });
  }

  const [brand] = await db
    .select({
      id: brands.id,
      niche: brands.niche,
      contentPillars: brands.contentPillars,
      weeklyFocus: brands.weeklyFocus,
      linkedinHandle: brands.linkedinHandle,
      mainstreamNewsEnabled: brands.mainstreamNewsEnabled,
    })
    .from(brands)
    .where(eq(brands.id, activeBrandId))
    .limit(1);

  if (!brand) {
    return NextResponse.json({ starters: DEFAULT_STARTERS, personalized: false });
  }

  const seed = todaySeed();
  const validPillars = (brand.contentPillars ?? [])
    .map(p => asTopicPhrase(p))
    .filter((p): p is string => p !== null);
  const focus = asTopicPhrase(brand.weeklyFocus);
  const niche = asNicheTag(brand.niche);
  const hasLinkedIn = !!brand.linkedinHandle;

  // ── News reaction (only if opt-in + a recent, high-scored item passed the
  // judge AND the headline cleans up nicely). Skipped silently otherwise.
  let cleanNews: string | null = null;
  if (brand.mainstreamNewsEnabled) {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const [top] = await db
      .select({ title: mainstreamNewsItems.title })
      .from(brandNewsScores)
      .innerJoin(mainstreamNewsItems, eq(brandNewsScores.newsItemId, mainstreamNewsItems.id))
      .where(
        and(
          eq(brandNewsScores.brandId, brand.id),
          gte(mainstreamNewsItems.publishedAt, since),
          gte(brandNewsScores.combinedScore, 6),
          or(isNull(brandNewsScores.skipReason), eq(brandNewsScores.skipReason, '')),
        ),
      )
      .orderBy(desc(brandNewsScores.combinedScore))
      .limit(1);
    cleanNews = cleanHeadline(top?.title);
  }

  const starters: string[] = [];

  // 1. Weekly focus, neutral wrapping that works across topic shapes.
  if (focus) {
    starters.push(`Share a take on this week's focus: ${focus}`);
  }

  // 2. Pillar starter, rotated daily across all valid pillars. Uses a neutral
  //    "about" frame so we don't have to fix "a/an" or worry about plurals.
  if (validPillars.length > 0) {
    const pillar = validPillars[seed % validPillars.length];
    starters.push(`Share a recent insight about ${pillar}`);
  }

  // 3. News reaction, only if cleaned headline survives.
  if (cleanNews) {
    starters.push(hasLinkedIn
      ? `Write a LinkedIn post reacting to: "${cleanNews}"`
      : `Write a post reacting to: "${cleanNews}"`);
  }

  // 4. Niche paste prompt, only if niche is a short, tag-like phrase.
  if (niche) {
    starters.push(`Paste a tweet, video, or article about ${niche} to riff on`);
  }

  // 5. Evergreen pool to fill remaining slots. Rotated daily.
  const evergreen = [
    'I shipped something new this week — help me write about it',
    'Share a lesson you learned this week and turn it into a post',
    'Paste a draft and ask for a sharper version',
    'Paste a competitor post and write a stronger angle on the same topic',
    'Turn a recent customer conversation into a post',
    'Pull a thread idea from a YouTube video — paste the link',
  ];
  for (const e of rotate(evergreen, seed)) {
    if (starters.length >= 4) break;
    if (!starters.includes(e)) starters.push(e);
  }

  return NextResponse.json({
    starters: starters.slice(0, 4),
    personalized: starters.some(s => !DEFAULT_STARTERS.includes(s) && !evergreen.includes(s)),
  });
}
