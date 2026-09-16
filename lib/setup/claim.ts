import { randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { sessions, users, verificationTokens } from '@/lib/db/schema';

// A fresh instance has no user and no way to sign in: a self-hoster has no Google
// app and no verified mail domain. The server mints one single-use link at boot
// and prints it to the terminal, so holding the terminal is the proof of
// ownership. Same bar as being able to read .env.local.
//
// The token lives in the database rather than in memory because the boot hook and
// the route handler are separate module instances and would not share a variable.

const IDENTIFIER = 'lore:claim';
const TOKEN_BYTES = 32;
const TOKEN_HOURS = 24;
const SESSION_DAYS = 30;

export async function isUnclaimed(): Promise<boolean> {
  try {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
    return (row?.n ?? 0) === 0;
  } catch {
    return true;
  }
}

/** Replaces any previous link, so only the newest one works. */
export async function issueClaimToken(): Promise<string | null> {
  try {
    const token = randomBytes(TOKEN_BYTES).toString('hex');
    await db.delete(verificationTokens).where(eq(verificationTokens.identifier, IDENTIFIER));
    await db.insert(verificationTokens).values({
      identifier: IDENTIFIER,
      token,
      expires: new Date(Date.now() + TOKEN_HOURS * 60 * 60 * 1000),
    });
    return token;
  } catch {
    return null;
  }
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export interface ClaimResult {
  ok: boolean;
  sessionToken?: string;
  error?: string;
}

export async function claimInstance(given: string, email?: string): Promise<ClaimResult> {
  if (!given) return { ok: false, error: 'missing token' };
  if (!(await isUnclaimed())) return { ok: false, error: 'already claimed' };

  const [row] = await db
    .select({ token: verificationTokens.token, expires: verificationTokens.expires })
    .from(verificationTokens)
    .where(eq(verificationTokens.identifier, IDENTIFIER))
    .limit(1);

  if (!row) return { ok: false, error: 'no link has been issued' };
  if (row.expires.getTime() < Date.now()) return { ok: false, error: 'link expired' };
  if (!sameToken(given, row.token)) return { ok: false, error: 'invalid token' };

  const ownerEmail = (email?.trim() || process.env.ADMIN_EMAIL?.trim() || 'owner@localhost').toLowerCase();

  const [user] = await db
    .insert(users)
    .values({ email: ownerEmail, emailVerified: new Date() })
    .onConflictDoUpdate({ target: users.email, set: { emailVerified: new Date() } })
    .returning({ id: users.id });

  if (!user) return { ok: false, error: 'could not create the owner account' };

  const sessionToken = randomBytes(TOKEN_BYTES).toString('hex');
  await db.insert(sessions).values({
    sessionToken,
    userId: user.id,
    expires: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  });

  await db
    .delete(verificationTokens)
    .where(and(eq(verificationTokens.identifier, IDENTIFIER), eq(verificationTokens.token, row.token)));

  return { ok: true, sessionToken };
}

export async function ownerExists(): Promise<boolean> {
  try {
    const [row] = await db.select({ id: users.id }).from(users).limit(1);
    return Boolean(row);
  } catch {
    return false;
  }
}
