// Small, honest computed insights: the "it knows me" facts.
// Every function here returns null unless the data actually supports the claim,
// so the agent never reports an invented number.

import { and, eq, gte, sql as dsql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { ownPosts } from '@/lib/db/schema';
import { fetchTweetReplies, type ReplyAuthor } from '@/lib/twitterapi';

const DAY = 24 * 60 * 60 * 1000;
const DOW_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// "Your tuesday posts pull ~2.1x your other days", only when the sample and
// the multiple are big enough to mean something.
export async function dayOfWeekInsight(brandId: string): Promise<string | null> {
  const since = new Date(Date.now() - 90 * DAY);
  const rows = await db
    .select({
      dow: dsql<number>`extract(dow from ${ownPosts.postedAt})::int`,
      avgEng: dsql<number>`avg(${ownPosts.likeCount} + ${ownPosts.retweetCount} * 2 + ${ownPosts.replyCount})::float`,
      n: dsql<number>`count(*)::int`,
    })
    .from(ownPosts)
    .where(and(eq(ownPosts.brandId, brandId), gte(ownPosts.postedAt, since)))
    .groupBy(dsql`extract(dow from ${ownPosts.postedAt})`);

  const total = rows.reduce((s, r) => s + r.n, 0);
  if (total < 12 || rows.length < 3) return null;

  let best: { dow: number; avgEng: number; n: number } | null = null;
  for (const r of rows) {
    if (r.n >= 3 && (!best || r.avgEng > best.avgEng)) best = r;
  }
  if (!best || best.avgEng <= 0) return null;

  const others = rows.filter(r => r.dow !== best!.dow);
  const otherAvg = others.reduce((s, r) => s + r.avgEng * r.n, 0) / Math.max(1, others.reduce((s, r) => s + r.n, 0));
  if (otherAvg <= 0) return null;

  const mult = best.avgEng / otherAvg;
  if (mult < 1.5) return null;
  return `one thing in the data: your ${DOW_NAMES[best.dow]} posts pull about ${mult.toFixed(1)}x your other days (${best.n} of them in the last 90).`;
}

export interface OrbitPerson {
  userName: string;
  name: string;
  followers: number;
  bio: string;
}

// "Cool people dropped by": reply authors on the last day's posts, largest
// accounts first, excluding the brand's own handle.
export async function peopleInOrbit(brandId: string, ownHandle: string | null): Promise<OrbitPerson[]> {
  const since = new Date(Date.now() - 1 * DAY);
  const posts = await db
    .select({ externalId: ownPosts.externalId, replyCount: ownPosts.replyCount })
    .from(ownPosts)
    .where(and(
      eq(ownPosts.brandId, brandId),
      eq(ownPosts.platform, 'twitter'),
      gte(ownPosts.postedAt, since),
    ))
    .orderBy(dsql`${ownPosts.replyCount} desc`)
    .limit(3);

  const withReplies = posts.filter(p => p.replyCount > 0);
  if (withReplies.length === 0) return [];

  const seen = new Map<string, ReplyAuthor>();
  for (const p of withReplies) {
    const authors = await fetchTweetReplies(p.externalId, 20).catch(() => [] as ReplyAuthor[]);
    for (const a of authors) {
      if (ownHandle && a.userName.toLowerCase() === ownHandle.toLowerCase().replace(/^@/, '')) continue;
      const prev = seen.get(a.userName.toLowerCase());
      if (!prev || a.followers > prev.followers) seen.set(a.userName.toLowerCase(), a);
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.followers - a.followers)
    .slice(0, 4)
    .map(a => ({ userName: a.userName, name: a.name, followers: a.followers, bio: a.description.slice(0, 60) }));
}

export function formatOrbit(people: OrbitPerson[]): string | null {
  if (people.length === 0) return null;
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
  const lines = people.map(p =>
    `@${p.userName} (${fmt(p.followers)})${p.bio ? ` — ${p.bio}` : ''}`);
  return `people who dropped by today:\n${lines.join('\n')}`;
}
