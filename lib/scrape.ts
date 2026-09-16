import type { CreditAction } from './credits';

export type ScrapeType = 'twitter' | 'youtube' | 'reddit' | 'url';

export interface ScrapeResult {
  type: ScrapeType;
  content: string;
  title?: string;
  creditAction?: CreditAction;
}

// Blocks loopback, link-local and RFC1918 targets so a caller-supplied URL can't
// reach cloud metadata or anything else on the internal network.
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;
const IP_LITERAL = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[.*\])$/;
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

// Parses a caller-supplied URL and rejects anything not a plain public http(s) target.
export function parsePublicHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported');
  }
  if (parsed.port && parsed.port !== DEFAULT_PORTS[parsed.protocol]) {
    throw new Error('Non-default ports are not allowed');
  }

  const host = parsed.hostname.toLowerCase();
  if (IP_LITERAL.test(host)) throw new Error('IP addresses are not allowed');
  if (PRIVATE_HOST.test(host)) throw new Error('Private hosts are not allowed');

  return parsed;
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function detectUrlType(url: string): ScrapeType {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'url';
  }
  if (hostMatches(host, 'twitter.com') || hostMatches(host, 'x.com')) return 'twitter';
  if (hostMatches(host, 'youtube.com') || hostMatches(host, 'youtu.be')) return 'youtube';
  if (hostMatches(host, 'reddit.com')) return 'reddit';
  return 'url';
}

export function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/);
  return match?.[0] ?? null;
}

const TYPE_TO_CREDIT: Partial<Record<ScrapeType, CreditAction>> = {
  twitter: 'scrape_twitter',
};

async function scrapeReddit(url: string): Promise<{ title: string; content: string }> {
  const parsed = parsePublicHttpUrl(url);
  if (!hostMatches(parsed.hostname.toLowerCase(), 'reddit.com')) {
    throw new Error('Not a reddit.com URL');
  }

  // Reddit's JSON API: append .json to any post URL. No auth needed.
  const jsonUrl = parsed.origin + parsed.pathname.replace(/\/$/, '') + '.json';
  const res = await fetch(jsonUrl, {
    headers: { 'User-Agent': 'Lore/1.0 content-research-tool' },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) throw new Error(`Reddit API failed: ${res.status}`);

  const data = await res.json() as Array<{ data: { children: Array<{ data: Record<string, unknown> }> } }>;
  const post = data[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error('No post data in Reddit response');

  const title = String(post.title ?? '');
  const body = String(post.selftext ?? '');
  const subreddit = String(post.subreddit_name_prefixed ?? '');
  const score = String(post.score ?? '');
  const numComments = String(post.num_comments ?? '');

  // Include top comments for richer context
  const comments = (data[1]?.data?.children ?? [])
    .slice(0, 6)
    .map(c => String((c.data as Record<string, unknown>).body ?? ''))
    .filter(b => b && b !== '[deleted]' && b !== '[removed]' && b.length > 20)
    .map(b => `- ${b.slice(0, 300)}`);

  const content = [
    `**${title}**`,
    subreddit ? `${subreddit} • ${score} upvotes • ${numComments} comments` : '',
    body ? `\n${body.slice(0, 2000)}` : '',
    comments.length ? `\n**Top comments:**\n${comments.join('\n')}` : '',
  ].filter(Boolean).join('\n');

  return { title, content };
}

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const target = parsePublicHttpUrl(url);
  const type = detectUrlType(url);
  const creditAction = TYPE_TO_CREDIT[type];

  // Reddit: JSON API first (structured, never 403'd), Jina as fallback
  if (type === 'reddit') {
    try {
      const { title, content } = await scrapeReddit(url);
      return { type, content, title, creditAction };
    } catch {
      // JSON API failed (private sub, deleted post, etc.), fall through to Jina
    }
  }

  // Everything else: Jina Reader (free, no key, returns clean markdown)
  const jinaUrl = `https://r.jina.ai/${target.href}`;
  const res = await fetch(jinaUrl, {
    headers: {
      'Accept': 'text/plain',
      'X-Return-Format': 'markdown',
      'X-Timeout': '12',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Scrape failed: HTTP ${res.status}`);
  }

  const raw = await res.text();
  const content = raw.slice(0, 6000).trim();

  // Jina sometimes returns a 200 with embedded error text instead of throwing
  if (/^\s*(Error|403|Forbidden|Access Denied|Unable to access)/i.test(content)) {
    throw new Error('Scrape failed: content blocked');
  }

  // Extract title from Jina's markdown (it always starts with "Title: ...")
  const titleMatch = content.match(/^Title:\s*(.+)/m);
  const title = titleMatch?.[1]?.trim();

  return { type, content, title, creditAction };
}
