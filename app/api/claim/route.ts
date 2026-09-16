import type { NextRequest } from 'next/server';
import { claimInstance } from '@/lib/setup/claim';
import { seeOther, sessionCookieName, sessionCookieOptions } from '@/lib/auth/local';

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
    return seeOther(result.error === 'claimed'
      ? '/login?claimed=1'
      : `/claim?token=${encodeURIComponent(token)}&error=${result.error}`);
  }

  const res = seeOther('/setup');
  res.cookies.set(sessionCookieName(), result.sessionToken, sessionCookieOptions());
  return res;
}
