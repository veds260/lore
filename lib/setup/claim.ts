import { randomBytes, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, verificationTokens } from '@/lib/db/schema';
import { MIN_PASSWORD, createSession, hashPassword, validEmail } from '@/lib/auth/local';

// A fresh instance has no user. The server mints one single-use link at boot,
// prints it and opens it in the browser, so holding the machine is the proof of
// ownership, the same bar as being able to read .env.local. Whoever opens it
// creates the owner account with an email and password.
//
// The token lives in the database rather than in memory because the boot hook and
// the route handler are separate module instances and would not share a variable.

const IDENTIFIER = 'lore:claim';
const TOKEN_BYTES = 32;
const TOKEN_HOURS = 24;

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

export async function claimTokenValid(given: string): Promise<boolean> {
  if (!given || !(await isUnclaimed())) return false;
  try {
    const [row] = await db
      .select({ token: verificationTokens.token, expires: verificationTokens.expires })
      .from(verificationTokens)
      .where(eq(verificationTokens.identifier, IDENTIFIER))
      .limit(1);
    return Boolean(row && row.expires.getTime() > Date.now() && sameToken(given, row.token));
  } catch {
    return false;
  }
}

export interface ClaimInput {
  token: string;
  name: string;
  email: string;
  password: string;
}

export type ClaimResult =
  | { ok: true; sessionToken: string }
  | { ok: false; error: 'invalid' | 'claimed' | 'email' | 'password' | 'failed' };

export async function claimInstance(input: ClaimInput): Promise<ClaimResult> {
  const email = input.email.trim().toLowerCase();
  if (!validEmail(email)) return { ok: false, error: 'email' };
  if (input.password.length < MIN_PASSWORD || input.password.length > 200) return { ok: false, error: 'password' };
  if (!(await isUnclaimed())) return { ok: false, error: 'claimed' };
  if (!(await claimTokenValid(input.token))) return { ok: false, error: 'invalid' };

  // Deleting the token is the claim. Only one request can delete it, so two tabs
  // racing on the same link cannot both become the owner.
  const consumed = await db
    .delete(verificationTokens)
    .where(and(
      eq(verificationTokens.identifier, IDENTIFIER),
      eq(verificationTokens.token, input.token),
      gt(verificationTokens.expires, new Date()),
    ))
    .returning({ token: verificationTokens.token });
  if (consumed.length === 0) return { ok: false, error: 'invalid' };
  if (!(await isUnclaimed())) return { ok: false, error: 'claimed' };

  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({ email, name: input.name.trim().slice(0, 80) || null, emailVerified: new Date(), passwordHash })
    .returning({ id: users.id });
  if (!user) return { ok: false, error: 'failed' };

  return { ok: true, sessionToken: await createSession(user.id) };
}

export type SetupAccess = 'open' | 'owner' | 'denied' | 'no-database';

/**
 * Who may see setup. Open while nobody owns the instance, then only the owner,
 * the first account created. A database it cannot read never counts as open.
 */
export async function setupAccess(): Promise<SetupAccess> {
  let owner: { id: string } | undefined;
  try {
    [owner] = await db.select({ id: users.id }).from(users).orderBy(asc(users.createdAt)).limit(1);
  } catch {
    return 'no-database';
  }
  if (!owner) return 'open';
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  return session?.user?.id === owner.id ? 'owner' : 'denied';
}
