import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { buildAuthUrl, codeChallenge, generateCodeVerifier } from '@/lib/x-oauth';

// Kicks off the X OAuth2 PKCE flow. State + verifier live in short-lived
// httpOnly cookies and are checked in the callback.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'));

  const state = generateCodeVerifier();
  const verifier = generateCodeVerifier();
  const challenge = await codeChallenge(verifier);

  const jar = await cookies();
  const cookieOpts = { httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge: 600, path: '/' };
  jar.set('x_oauth_state', state, cookieOpts);
  jar.set('x_oauth_verifier', verifier, cookieOpts);

  return NextResponse.redirect(buildAuthUrl(state, challenge));
}
