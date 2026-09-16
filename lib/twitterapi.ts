import { activeRelayKey, relayFetch } from './relay/client';

const BASE = 'https://api.twitterapi.io';

interface RawTweet {
  id: string;
  text: string;
  createdAt: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount?: number;
  viewCount?: number;
  author?: { userName: string; name: string };
}

interface XResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

// One way out to twitterapi.io. Your own key goes direct. Without one, the shared
// relay forwards the same path and params and returns the same JSON. With
// neither, X lookups are off.
async function xGet(path: string, params: URLSearchParams, timeoutMs?: number): Promise<XResponse> {
  const key = process.env.TWITTERAPI_IO_KEY;
  if (key) {
    return fetch(`${BASE}${path}?${params}`, {
      headers: { 'x-api-key': key },
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  }

  if (await activeRelayKey()) {
    const relayParams = new URLSearchParams({ path });
    for (const [k, v] of params) relayParams.append(k, v);
    const res = await relayFetch(`/x?${relayParams}`, { method: 'GET', ...(timeoutMs ? { timeoutMs } : {}) });
    return { ok: res.ok, status: res.status, json: () => res.json() };
  }

  throw new Error('X lookups are not configured');
}

/** True when X lookups can run, through the user's own key or the shared relay. */
export async function xAvailable(): Promise<boolean> {
  if (process.env.TWITTERAPI_IO_KEY) return true;
  const { activeRelayKey } = await import('./relay/client');
  return Boolean(await activeRelayKey());
}

export function extractTweetId(url: string): string | null {
  return url.match(/(?:twitter\.com|x\.com)\/[^/\s]+\/status\/(\d+)/)?.[1] ?? null;
}

export interface TwitterUserInfo {
  avatarUrl: string | null;
  followerCount: number | null;
  name: string | null;
  description: string | null;
  location: string | null;
}

export async function fetchUserInfo(handle: string): Promise<TwitterUserInfo | null> {
  try {
    const params = new URLSearchParams({ userName: handle.replace(/^@/, '') });
    const res = await xGet('/twitter/user/info', params, 10000);
    if (!res.ok) return null;
    const data = await res.json() as { data?: { profilePicture?: string; followers?: number; name?: string; description?: string; location?: string } };
    const d = data?.data;
    if (!d) return null;
    return {
      avatarUrl: d.profilePicture ? d.profilePicture.replace('_normal', '_400x400') : null,
      followerCount: d.followers ?? null,
      name: d.name ?? null,
      description: d.description ?? null,
      location: d.location ?? null,
    };
  } catch {
    return null;
  }
}

// Uses advanced_search with the from: operator, avoids the intermittent /last_tweets 0-tweet bug
export async function fetchUserTweets(handle: string, count = 10): Promise<RawTweet[]> {
  const params = new URLSearchParams({
    query: `from:${handle.replace(/^@/, '')} -filter:retweets -filter:replies`,
    queryType: 'Latest',
  });
  const res = await xGet('/twitter/tweet/advanced_search', params, 12000);
  if (!res.ok) throw new Error(`twitterapi.io ${res.status}`);
  const data = await res.json() as { tweets?: RawTweet[]; status?: string };
  if (data.status === 'error') throw new Error('Twitter API error');
  return (data.tweets ?? []).slice(0, count);
}

export async function searchTweets(query: string, count = 10): Promise<RawTweet[]> {
  const params = new URLSearchParams({
    query: `${query} -filter:retweets`,
    queryType: 'Top',
  });
  const res = await xGet('/twitter/tweet/advanced_search', params, 12000);
  if (!res.ok) throw new Error(`twitterapi.io ${res.status}`);
  const data = await res.json() as { tweets?: RawTweet[]; status?: string };
  if (data.status === 'error') throw new Error('Twitter API error');
  return (data.tweets ?? []).slice(0, count);
}

// Fetch a founder's own tweets going back `since` date using time-window sliding.
// TwitterAPI.io cursor pagination loops on historical data, so slide the until_time
// window instead: take the earliest tweet timestamp - 1s as next until_time.
// <20 tweets returned from a window = that time shard is exhausted, stop.
export async function fetchUserTweetsSince(
  handle: string,
  since: Date,
  maxTweets = 200,
): Promise<RawTweet[]> {
  const clean = handle.replace(/^@/, '');
  const sinceUnix = Math.floor(since.getTime() / 1000);
  let untilUnix = Math.floor(Date.now() / 1000);
  const collected: RawTweet[] = [];

  while (collected.length < maxTweets) {
    const params = new URLSearchParams({
      query: `from:${clean} -filter:retweets -filter:replies since_time:${sinceUnix} until_time:${untilUnix}`,
      queryType: 'Latest',
    });
    let batch: RawTweet[] = [];
    try {
      const res = await xGet('/twitter/tweet/advanced_search', params, 15000);
      if (!res.ok) break;
      const data = await res.json() as { tweets?: RawTweet[] };
      batch = data.tweets ?? [];
    } catch {
      break;
    }
    if (batch.length === 0) break;
    collected.push(...batch);
    // Shard exhausted when fewer than 20 tweets returned
    if (batch.length < 20) break;
    // Slide window to just before the earliest tweet in this batch
    const earliest = batch.reduce((min, t) =>
      new Date(t.createdAt) < new Date(min.createdAt) ? t : min
    );
    untilUnix = Math.floor(new Date(earliest.createdAt).getTime() / 1000) - 1;
    if (untilUnix <= sinceUnix) break;
  }

  // Deduplicate (same tweet can appear across window boundaries) and filter to range
  const seen = new Set<string>();
  return collected.filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return new Date(t.createdAt) >= since;
  }).slice(0, maxTweets);
}

export interface ReplyAuthor {
  userName: string;
  name: string;
  followers: number;
  description: string;
}

// Replies to one tweet, used for the "people in your orbit" section of the
// evening report. Returns reply authors only; the tweet text is not needed.
export async function fetchTweetReplies(tweetId: string, count = 20): Promise<ReplyAuthor[]> {
  try {
    const res = await xGet('/twitter/tweet/replies', new URLSearchParams({ tweetId }));
    if (!res.ok) return [];
    const data = await res.json() as { tweets?: Array<{ author?: { userName?: string; name?: string; followers?: number; description?: string } }> };
    const out: ReplyAuthor[] = [];
    for (const t of (data.tweets ?? []).slice(0, count)) {
      const a = t.author;
      if (!a?.userName) continue;
      out.push({
        userName: a.userName,
        name: a.name ?? a.userName,
        followers: a.followers ?? 0,
        description: (a.description ?? '').replace(/\s+/g, ' ').trim(),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchTweetById(id: string): Promise<RawTweet | null> {
  const params = new URLSearchParams({ tweet_ids: id });
  const res = await xGet('/twitter/tweets', params, 12000);
  if (!res.ok) throw new Error(`twitterapi.io ${res.status}`);
  const data = await res.json() as { tweets?: RawTweet[] };
  return data.tweets?.[0] ?? null;
}

function fmt(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function formatTweetsText(tweets: RawTweet[], label?: string): string {
  if (!tweets.length) {
    return label ? `No recent tweets found for ${label}.` : 'No tweets found matching that search.';
  }
  const intro = label ? `Recent tweets from ${label}:\n\n` : 'Top results:\n\n';
  return intro + tweets.map((t, i) => {
    const by = t.author?.userName ? `@${t.author.userName}: ` : '';
    const stats = [
      t.likeCount ? `${fmt(t.likeCount)} likes` : '',
      t.retweetCount ? `${fmt(t.retweetCount)} RTs` : '',
      t.replyCount ? `${fmt(t.replyCount)} replies` : '',
    ].filter(Boolean).join(' · ');
    return `${i + 1}. ${by}${t.text}${stats ? `\n   [${stats}]` : ''}`;
  }).join('\n\n');
}

export function formatSingleTweet(tweet: RawTweet): string {
  const by = tweet.author?.userName ? `@${tweet.author.userName}` : 'Unknown';
  const stats = [
    `${fmt(tweet.likeCount)} likes`,
    `${fmt(tweet.retweetCount)} RTs`,
    `${fmt(tweet.replyCount)} replies`,
    tweet.quoteCount ? `${fmt(tweet.quoteCount)} quotes` : '',
  ].filter(Boolean).join(' · ');
  return `Tweet by ${by}:\n\n"${tweet.text}"\n\nEngagement: ${stats}`;
}

// ─── Server-side intent detection ────────────────────────────────────────────
// Catches clear-cut Twitter lookups before calling the AI, saving generate credits.

export type TwitterLookupIntent =
  | { intent: 'tweet_url'; tweetUrl: string }
  | { intent: 'profile'; handle: string }
  | { intent: 'search'; query: string };

// Only fires on explicit Twitter/X lookup requests, not on casual mentions or post writing requests.
// Requires a clear Twitter signal word to avoid eating credits on ambiguous inputs.
const TWITTER_SIGNAL = /\b(?:twitter|x\.com|tweet|tweets|tweeting|tweeted)\b/i;

export function detectTwitterLookup(text: string): TwitterLookupIntent | null {
  // Tweet URL: clearest signal, check first (no need for keyword)
  const urlMatch = text.match(/https?:\/\/(?:twitter\.com|x\.com)\/[^/\s]+\/status\/\d+/);
  if (urlMatch) return { intent: 'tweet_url', tweetUrl: urlMatch[0] };

  // Must have an explicit Twitter signal word for everything else
  if (!TWITTER_SIGNAL.test(text)) return null;

  // @handle + twitter context
  const handleMatch = text.match(/@([A-Za-z0-9_]{1,15})/);
  if (handleMatch) {
    return { intent: 'profile', handle: handleMatch[1] };
  }

  // Explicit search with twitter signal already confirmed above
  const aboutMatch = text.match(/\babout\s+(.+?)(?:\?|$)/i);
  const query = (aboutMatch?.[1] ?? text.replace(TWITTER_SIGNAL, '').trim());
  if (query.length > 2) return { intent: 'search', query };

  return null;
}
