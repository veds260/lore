import NextAuth from 'next-auth';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import Google from 'next-auth/providers/google';
import Resend from 'next-auth/providers/resend';
import type { Provider } from 'next-auth/providers';
import { db } from '@/lib/db';
import { accounts, sessions, users, verificationTokens } from '@/lib/db/schema';

const providers: Provider[] = [];

// Magic link, only when a key exists. Registering it without one produced a
// sign-in button that always failed, and the sender has to be a domain the
// operator has verified, not ours.
if (process.env.RESEND_API_KEY) {
  providers.push(
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.LORE_MAIL_FROM || 'Lore <onboarding@resend.dev>',
    }),
  );
}

// Google OAuth, only registered when both vars are present
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'database' },
  providers,
  pages: {
    signIn: '/login',
    verifyRequest: '/login/verify',
  },
  callbacks: {
    // With database sessions Auth.js hands over the whole user row and the session
    // token. Only pass on what the app reads, so /api/auth/session never exposes
    // password hashes, link tokens or the session token to page scripts.
    session({ session, user }) {
      return {
        expires: session.expires,
        user: { id: user.id, name: user.name ?? null, email: user.email, image: user.image ?? null },
      } as typeof session;
    },
  },
});
