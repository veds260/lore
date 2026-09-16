import type { NextRequest } from 'next/server';
import {
  clearFailures, createSession, findPasswordUser, lockedOut, recordFailure,
  seeOther, sessionCookieName, sessionCookieOptions, verifyPassword,
} from '@/lib/auth/local';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase().slice(0, 254);
  const password = String(form.get('password') ?? '').slice(0, 200);
  const limitKey = email;

  const fail = (error: string) => seeOther(`/login?error=${error}`);

  if (lockedOut(limitKey)) return fail('locked');
  if (!email || !password) return fail('password');

  const user = await findPasswordUser(email).catch(() => null);
  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!ok || !user) {
    recordFailure(limitKey);
    return fail('password');
  }

  clearFailures(limitKey);
  const res = seeOther('/board');
  res.cookies.set(sessionCookieName(), await createSession(user.id), sessionCookieOptions());
  return res;
}
