import { NextResponse, type NextRequest } from 'next/server';
import { claimInstance } from '@/lib/setup/claim';
import { sessionCookieName, sessionCookieOptions } from '@/lib/auth/local';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const field = (k: string) => String(form.get(k) ?? '');
  const token = field('token');

  const result = await claimInstance({
    token,
    name: field('name'),
    email: field('email'),
    password: field('password'),
  });

  if (!result.ok) {
    const back = result.error === 'claimed'
      ? new URL('/login?claimed=1', req.nextUrl.origin)
      : new URL(`/claim?token=${encodeURIComponent(token)}&error=${result.error}`, req.nextUrl.origin);
    return NextResponse.redirect(back, 303);
  }

  const res = NextResponse.redirect(new URL('/setup', req.nextUrl.origin), 303);
  res.cookies.set(sessionCookieName(), result.sessionToken, sessionCookieOptions());
  return res;
}
