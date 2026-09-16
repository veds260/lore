// Pulls fresh news items from public RSS / JSON feeds into mainstream_news_items.
// Dedupe is URL-based. No scoring happens here; the per-brand smart scorer in
// score-news-for-brand.ts is responsible for filtering.

import { db } from './db';
import { mainstreamNewsItems } from './db/schema';
import { sql } from 'drizzle-orm';

interface RawItem {
  source: string;
  title: string;
  summary?: string;
  url: string;
  imageUrl?: string;
  publishedAt?: Date;
}

// ── TechCrunch RSS ──────────────────────────────────────────────────────────
async function fetchTechCrunch(): Promise<RawItem[]> {
  try {
    const res = await fetch('https://techcrunch.com/feed/', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml, 'techcrunch');
  } catch (err) {
    console.error('[mainstream-news] TechCrunch fetch failed:', err);
    return [];
  }
}

// ── The Verge RSS ───────────────────────────────────────────────────────────
async function fetchTheVerge(): Promise<RawItem[]> {
  try {
    const res = await fetch('https://www.theverge.com/rss/index.xml', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml, 'verge');
  } catch (err) {
    console.error('[mainstream-news] Verge fetch failed:', err);
    return [];
  }
}

// ── Hacker News top stories via API ─────────────────────────────────────────
async function fetchHackerNews(): Promise<RawItem[]> {
  try {
    const topRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', { signal: AbortSignal.timeout(10000) });
    if (!topRes.ok) return [];
    const ids = (await topRes.json() as number[]).slice(0, 30);
    const items: (RawItem | null)[] = await Promise.all(ids.map(async (id): Promise<RawItem | null> => {
      try {
        const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return null;
        const item = await r.json() as { type?: string; title?: string; url?: string; time?: number; score?: number };
        if (item.type !== 'story' || !item.url || !item.title) return null;
        if ((item.score ?? 0) < 50) return null;
        return {
          source: 'hackernews',
          title: item.title,
          url: item.url,
          publishedAt: item.time ? new Date(item.time * 1000) : undefined,
        };
      } catch { return null; }
    }));
    return items.filter((x): x is RawItem => x !== null);
  } catch (err) {
    console.error('[mainstream-news] HN fetch failed:', err);
    return [];
  }
}

// ── TechMeme RSS ────────────────────────────────────────────────────────────
async function fetchTechMeme(): Promise<RawItem[]> {
  try {
    const res = await fetch('https://www.techmeme.com/feed.xml', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml, 'techmeme');
  } catch (err) {
    console.error('[mainstream-news] TechMeme fetch failed:', err);
    return [];
  }
}

// Minimal RSS/Atom parser: extracts <item>/<entry>, <title>, <link>, <description>, <pubDate>/<published>.
// Avoids pulling in a heavyweight XML lib for this hot path.
function parseRss(xml: string, source: string): RawItem[] {
  const items: RawItem[] = [];
  // Try <item> (RSS) first, then <entry> (Atom)
  const itemRegex = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[2];
    const title = decodeXml(extractTag(block, 'title') ?? '').trim();
    const linkRaw = extractTag(block, 'link') ?? '';
    const linkHrefMatch = block.match(/<link[^>]*href="([^"]+)"/);
    const url = (linkHrefMatch?.[1] ?? linkRaw).trim();
    if (!title || !url) continue;
    const summary = decodeXml(extractTag(block, 'description') ?? extractTag(block, 'summary') ?? '').replace(/<[^>]+>/g, '').slice(0, 600).trim();
    const dateRaw = extractTag(block, 'pubDate') ?? extractTag(block, 'published') ?? extractTag(block, 'updated');
    const publishedAt = dateRaw ? new Date(dateRaw) : undefined;
    items.push({ source, title, summary, url, publishedAt });
    if (items.length >= 30) break; // cap per feed
  }
  return items;
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1') : null;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ── Public entry point ──────────────────────────────────────────────────────
export async function syncMainstreamNews(): Promise<{ fetched: number; inserted: number; perSource: Record<string, number> }> {
  const [tc, hn, tm, verge] = await Promise.all([
    fetchTechCrunch(),
    fetchHackerNews(),
    fetchTechMeme(),
    fetchTheVerge(),
  ]);
  const all = [...tc, ...hn, ...tm, ...verge];
  const perSource: Record<string, number> = {};
  let inserted = 0;
  for (const item of all) {
    perSource[item.source] = (perSource[item.source] ?? 0) + 1;
    try {
      const result = await db.insert(mainstreamNewsItems).values({
        source: item.source,
        title: item.title.slice(0, 500),
        summary: item.summary?.slice(0, 2000) ?? null,
        url: item.url,
        publishedAt: item.publishedAt ?? null,
        // namedEntities is left default empty; the scorer extracts them lazily per brand
      }).onConflictDoNothing({ target: mainstreamNewsItems.url }).returning({ id: mainstreamNewsItems.id });
      if (result.length > 0) inserted++;
    } catch (err) {
      // Skip individual failures, never break the whole sync
      console.error('[mainstream-news] insert failed:', item.url, err instanceof Error ? err.message : err);
    }
  }
  // Trim old items older than 14 days to keep table size bounded
  await db.execute(sql`DELETE FROM mainstream_news_items WHERE fetched_at < now() - interval '14 days'`);
  return { fetched: all.length, inserted, perSource };
}
