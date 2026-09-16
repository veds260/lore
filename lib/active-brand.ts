import { cookies } from 'next/headers';
import { and, desc, eq } from 'drizzle-orm';
import { db } from './db';
import { brands } from './db/schema';

const COOKIE_NAME = 'lore_active_brand';

// Reads the cookie first, falls back to the most recent active brand.
// The cookie's brand is re-checked against the user and isActive on every read.
export async function getActiveBrandId(userId: string): Promise<string | null> {
  const cookieStore = await cookies();
  const cookieBrandId = cookieStore.get(COOKIE_NAME)?.value;

  if (cookieBrandId) {
    const [match] = await db
      .select({ id: brands.id })
      .from(brands)
      .where(and(
        eq(brands.id, cookieBrandId),
        eq(brands.userId, userId),
        eq(brands.isActive, true),
      ))
      .limit(1);
    if (match) return match.id;
  }

  // Fall back to most recent active brand
  const [fallback] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.userId, userId), eq(brands.isActive, true)))
    .orderBy(desc(brands.createdAt))
    .limit(1);

  return fallback?.id ?? null;
}

// Must be called from a server action or route handler.
export async function setActiveBrandCookie(brandId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, brandId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
}

export async function clearActiveBrandCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
