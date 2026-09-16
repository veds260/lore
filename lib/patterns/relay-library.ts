/**
 * Tops up the local template library from the shared relay.
 *
 * A fresh install has few or no post_patterns rows, so the pickers have nothing to
 * rotate through. When the relay is connected, this pulls a handful of curated
 * templates per post type into the local table, keeping the relay's ids so the
 * same template never lands twice. It never throws and never blocks for long:
 * a failed or exhausted relay just means the picker works with what is local.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { postPatterns } from '@/lib/db/schema';
import { activeRelayKey, relayFetch, RelayError } from '@/lib/relay/client';

const POST_TYPES = ['tweet', 'long-post'] as const;
const MIN_LOCAL = 15;
const FETCH_LIMIT = 10;
const THROTTLE_MS = 10 * 60 * 1000;

interface RelayPattern {
  id: string;
  name: string;
  template: string;
  description: string | null;
  example: string | null;
  hookType: string | null;
  formatType: string | null;
  bodyStructure: string | null;
  closerType: string | null;
  engagementTarget: string | null;
  coreInsight: string | null;
  viralMechanic: string | null;
  emotionTrigger: string | null;
  reusableFor: string[] | null;
  postType: string | null;
  contentCategory: string | null;
  isQrt: boolean | null;
}

let lastAttempt = 0;

export async function ensurePatternLibrary(): Promise<void> {
  try {
    if (Date.now() - lastAttempt < THROTTLE_MS) return;
    if (!(await activeRelayKey())) return;
    lastAttempt = Date.now();

    for (const postType of POST_TYPES) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(postPatterns)
        .where(and(eq(postPatterns.isActive, true), eq(postPatterns.postType, postType)));
      if ((row?.n ?? 0) >= MIN_LOCAL) continue;

      let patterns: RelayPattern[];
      try {
        const params = new URLSearchParams({ postType, limit: String(FETCH_LIMIT) });
        const res = await relayFetch(`/patterns?${params}`, { method: 'GET', timeoutMs: 8000 });
        const data = (await res.json()) as { patterns?: RelayPattern[] };
        patterns = Array.isArray(data.patterns) ? data.patterns : [];
      } catch (err) {
        if (err instanceof RelayError) {
          console.warn(`[patterns] relay library skipped for ${postType}: ${err.code}`);
          continue;
        }
        throw err;
      }

      const rows = patterns
        .filter((p) => p && typeof p.id === 'string' && p.name && p.template)
        .map((p) => ({
          id: p.id,
          name: p.name,
          template: p.template,
          description: p.description ?? null,
          example: p.example ?? null,
          hookType: p.hookType ?? null,
          formatType: p.formatType ?? null,
          bodyStructure: p.bodyStructure ?? null,
          closerType: p.closerType ?? null,
          engagementTarget: p.engagementTarget ?? null,
          coreInsight: p.coreInsight ?? null,
          viralMechanic: p.viralMechanic ?? null,
          emotionTrigger: p.emotionTrigger ?? null,
          reusableFor: Array.isArray(p.reusableFor) ? p.reusableFor : [],
          postType: p.postType ?? postType,
          contentCategory: p.contentCategory ?? null,
          isQrt: p.isQrt === true,
          isActive: true,
        }));
      if (rows.length === 0) continue;

      await db.insert(postPatterns).values(rows).onConflictDoNothing();
    }
  } catch (err) {
    console.warn('[patterns] relay library top-up failed:', err instanceof Error ? err.message : String(err));
  }
}
