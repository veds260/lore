import { db } from '@/lib/db';
import { ownPosts, brands, followerSnapshots } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

interface UgcPost {
  id: string;
  specificContent?: {
    'com.linkedin.ugc.ShareContent'?: {
      shareCommentary?: { text?: string };
    };
  };
  firstPublishedAt?: number; // Unix ms
  lastModifiedAt?: number;
}

interface UgcResponse {
  elements?: UgcPost[];
  paging?: { start: number; count: number; total: number };
}

async function refreshIfNeeded(brandId: string, brand: {
  linkedinAccessToken: string;
  linkedinRefreshToken: string | null;
  linkedinTokenExpiresAt: Date | null;
}): Promise<string | null> {
  const expiresAt = brand.linkedinTokenExpiresAt?.getTime() ?? 0;
  if (expiresAt - Date.now() > 5 * 60 * 1000) return brand.linkedinAccessToken;

  if (!brand.linkedinRefreshToken) return null;
  try {
    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: brand.linkedinRefreshToken,
        client_id: process.env.LINKEDIN_CLIENT_ID!,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    await db.update(brands).set({
      linkedinAccessToken: data.access_token,
      linkedinRefreshToken: data.refresh_token ?? brand.linkedinRefreshToken,
      linkedinTokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
    }).where(eq(brands.id, brandId));
    return data.access_token;
  } catch {
    return null;
  }
}

export async function syncLinkedInPosts(brandId: string, _handle: string): Promise<number> {
  const [brand] = await db
    .select({
      linkedinPersonId: brands.linkedinPersonId,
      linkedinAccessToken: brands.linkedinAccessToken,
      linkedinRefreshToken: brands.linkedinRefreshToken,
      linkedinTokenExpiresAt: brands.linkedinTokenExpiresAt,
    })
    .from(brands)
    .where(eq(brands.id, brandId));

  if (!brand?.linkedinPersonId || !brand.linkedinAccessToken) return 0;

  const token = await refreshIfNeeded(brandId, brand as {
    linkedinAccessToken: string;
    linkedinRefreshToken: string | null;
    linkedinTokenExpiresAt: Date | null;
  });
  if (!token) return 0;

  const personUrn = brand.linkedinPersonId.startsWith('urn:li:person:')
    ? brand.linkedinPersonId
    : `urn:li:person:${brand.linkedinPersonId}`;

  // Snapshot follower count
  try {
    const profileRes = await fetch(
      `https://api.linkedin.com/v2/people/(id:${brand.linkedinPersonId})?projection=(numFollowers)`,
      { headers: { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' } }
    );
    if (profileRes.ok) {
      const p = await profileRes.json() as { numFollowers?: number };
      if (p.numFollowers != null) {
        await db.insert(followerSnapshots).values({
          brandId, platform: 'linkedin', followerCount: p.numFollowers,
        });
      }
    }
  } catch { /* non-critical */ }

  let inserted = 0;
  let start = 0;
  const count = 20;
  const MAX_PAGES = 3;

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const params = new URLSearchParams({
        q: 'authors',
        authors: `List(${encodeURIComponent(personUrn)})`,
        start: String(start),
        count: String(count),
      });

      const res = await fetch(`https://api.linkedin.com/v2/ugcPosts?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        signal: AbortSignal.timeout(20_000),
      });

      if (!res.ok) {
        console.error('LinkedIn ugcPosts error:', res.status, await res.text());
        break;
      }

      const data = await res.json() as UgcResponse;
      const posts = data.elements ?? [];
      if (posts.length === 0) break;

      for (const p of posts) {
        const content =
          p.specificContent?.['com.linkedin.ugc.ShareContent']?.shareCommentary?.text;
        if (!p.id || !content) continue;

        const postedAt = p.firstPublishedAt
          ? new Date(p.firstPublishedAt)
          : p.lastModifiedAt
          ? new Date(p.lastModifiedAt)
          : new Date();

        try {
          await db.insert(ownPosts).values({
            brandId,
            platform: 'linkedin',
            externalId: p.id,
            content,
            postedAt,
            likeCount: 0,
            retweetCount: 0,
            commentCount: 0,
            fetchedAt: new Date(),
          }).onConflictDoUpdate({
            target: [ownPosts.brandId, ownPosts.externalId],
            set: { fetchedAt: new Date() },
          });
          inserted++;
        } catch { /* skip */ }
      }

      if (posts.length < count) break;
      start += count;
    } catch {
      break;
    }
  }

  return inserted;
}
