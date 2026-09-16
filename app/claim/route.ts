import { NextResponse, type NextRequest } from 'next/server';
import { claimInstance, isUnclaimed } from '@/lib/setup/claim';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COOKIE = process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://')
  ? '__Secure-authjs.session-token'
  : 'authjs.session-token';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const email = req.nextUrl.searchParams.get('email') ?? undefined;

  if (!(await isUnclaimed())) {
    return NextResponse.redirect(new URL('/login?claimed=1', req.nextUrl.origin));
  }

  const result = await claimInstance(token, email);
  if (!result.ok || !result.sessionToken) {
    return new NextResponse(
      'This setup link is not valid. Restart the server to get a fresh one, then use the link it prints.',
      { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  const res = NextResponse.redirect(new URL('/setup', req.nextUrl.origin));
  res.cookies.set(COOKIE, result.sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE.startsWith('__Secure-'),
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}
