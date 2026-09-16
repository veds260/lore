import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { and, desc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { accountConnections, brands } from '@/lib/db/schema';
import { exchangeCode, getMe } from '@/lib/x-oauth';

function settingsRedirect(param: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return NextResponse.redirect(`${base.replace(/\/$/, '')}/settings?${param}`);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return settingsRedirect('x_error=unauthorized');

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');

  const jar = await cookies();
  const savedState = jar.get('x_oauth_state')?.value;
  const verifier = jar.get('x_oauth_verifier')?.value;
  jar.delete('x_oauth_state');
  jar.delete('x_oauth_verifier');

  if (!code || !state || !savedState || state !== savedState || !verifier) {
    return settingsRedirect('x_error=state_mismatch');
  }

  try {
    const tokens = await exchangeCode(code, verifier);
    // One identity call at connect time, the only read this app ever makes
    // on the official API.
    const me = await getMe(tokens.accessToken);

    const [brand] = await db
      .select({ id: brands.id })
      .from(brands)
      .where(and(eq(brands.userId, session.user.id), eq(brands.isActive, true)))
      .orderBy(desc(brands.createdAt))
      .limit(1);
    if (!brand) return settingsRedirect('x_error=no_brand');

    await db.update(brands)
      .set({
        xUserId: me.id,
        xUsername: me.username,
        xAccessToken: tokens.accessToken,
        xRefreshToken: tokens.refreshToken,
        xTokenExpiresAt: tokens.expiresAt,
        xScope: tokens.scope,
        updatedAt: new Date(),
      })
      .where(eq(brands.id, brand.id));

    await db.insert(accountConnections)
      .values({ userId: session.user.id, platform: 'twitter' })
      .onConflictDoUpdate({
        target: [accountConnections.userId, accountConnections.platform],
        set: { lastVerifiedAt: new Date() },
      });

    return settingsRedirect('x_connected=1');
  } catch (err) {
    console.error('[x-oauth callback]', err instanceof Error ? err.message : err);
    return settingsRedirect('x_error=exchange_failed');
  }
}
