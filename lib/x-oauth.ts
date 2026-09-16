// Official X API OAuth2 (user context, PKCE + confidential client).
//
// POSTING ONLY. The official API is used exclusively to publish posts.
// Never add a read path on these tokens (no timelines, no metrics, no search):
// all reads in this app go through twitterapi.io. The official key was once
// drained by uncached analytics reads; that mistake stays dead.
// The single exception is one /2/users/me call at connect time to capture the
// account's id + handle for display and post URLs.
//
// Env: X_CLIENT_ID, X_CLIENT_SECRET (OAuth2 app credentials from the X
// developer portal, callback set to {NEXT_PUBLIC_APP_URL}/api/auth/x/callback).

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const TWEETS_URL = 'https://api.x.com/2/tweets';
const ME_URL = 'https://api.x.com/2/users/me';

export const X_SCOPES = 'tweet.read tweet.write users.read offline.access';

function clientId(): string {
  const v = process.env.X_CLIENT_ID;
  if (!v) throw new Error('X_CLIENT_ID not set');
  return v;
}

function basicAuth(): string {
  const secret = process.env.X_CLIENT_SECRET;
  if (!secret) throw new Error('X_CLIENT_SECRET not set');
  return Buffer.from(`${clientId()}:${secret}`).toString('base64');
}

export function callbackUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL;
  if (!base) throw new Error('NEXT_PUBLIC_APP_URL not set');
  return `${base.replace(/\/$/, '')}/api/auth/x/callback`;
}

// PKCE: code verifier + S256 challenge.
export function generateCodeVerifier(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Buffer.from(arr).toString('base64url');
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString('base64url');
}

export function buildAuthUrl(state: string, challenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: callbackUrl(),
    scope: X_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface XTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
}

async function tokenRequest(body: URLSearchParams): Promise<XTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth()}`,
    },
    body,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`X token request failed (${res.status}): ${err.slice(0, 300)}`);
  }
  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 7200) * 1000),
    scope: data.scope ?? X_SCOPES,
  };
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<XTokens> {
  return tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl(),
    code_verifier: codeVerifier,
    client_id: clientId(),
  }));
}

// X rotates refresh tokens, always persist the returned refreshToken.
export async function refreshAccessToken(refreshToken: string): Promise<XTokens> {
  return tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId(),
  }));
}

// Connect-time identity call. The ONLY allowed read on the official API.
export async function getMe(accessToken: string): Promise<{ id: string; username: string }> {
  const res = await fetch(ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`X /users/me failed (${res.status}): ${err.slice(0, 300)}`);
  }
  const data = await res.json() as { data: { id: string; username: string } };
  return { id: data.data.id, username: data.data.username };
}

export async function postTweet(accessToken: string, text: string): Promise<{ id: string }> {
  const res = await fetch(TWEETS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`X post failed (${res.status}): ${err.slice(0, 300)}`);
  }
  const data = await res.json() as { data: { id: string } };
  return { id: data.data.id };
}

export function postUrl(username: string | null, tweetId: string): string {
  return `https://x.com/${username ?? 'i'}/status/${tweetId}`;
}
