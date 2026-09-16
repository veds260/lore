import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { sessions, users } from '@/lib/db/schema';

// Email and password sign-in for self-hosted installs, which usually have no mail
// sender and no Google app. Sessions are the same database sessions Auth.js reads,
// so everything past sign-in works unchanged.

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

const KEY_LEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_DAYS = 30;

export const MIN_PASSWORD = 8;

export function sessionCookieName(): string {
  return process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://')
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: sessionCookieName().startsWith('__Secure-'),
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Hash against a throwaway salt when there is no stored hash, so a missing
  // account takes as long to reject as a wrong password.
  const [scheme, saltB64, keyB64] = (stored ?? '').split('$');
  const salt = scheme === 'scrypt' && saltB64 ? Buffer.from(saltB64, 'base64') : randomBytes(16);
  const expected = scheme === 'scrypt' && keyB64 ? Buffer.from(keyB64, 'base64') : randomBytes(KEY_LEN);
  const actual = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, SCRYPT);
  return scheme === 'scrypt' && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function createSession(userId: string): Promise<string> {
  const sessionToken = randomBytes(32).toString('hex');
  await db.insert(sessions).values({
    sessionToken,
    userId,
    expires: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  });
  return sessionToken;
}

export async function findPasswordUser(email: string) {
  const [row] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

export function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Failed attempts per email and per client, kept in memory. Ten misses in fifteen
// minutes locks that pair out until the window passes.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const fails = new Map<string, { since: number; n: number }>();

export function lockedOut(key: string): boolean {
  const f = fails.get(key);
  if (!f) return false;
  if (Date.now() - f.since > WINDOW_MS) {
    fails.delete(key);
    return false;
  }
  return f.n >= MAX_FAILS;
}

export function recordFailure(key: string): void {
  const f = fails.get(key);
  if (!f || Date.now() - f.since > WINDOW_MS) fails.set(key, { since: Date.now(), n: 1 });
  else f.n++;
  if (fails.size > 10_000) fails.clear();
}

export function clearFailures(key: string): void {
  fails.delete(key);
}
