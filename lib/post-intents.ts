// Plain share links. Posting happens in the user's own X or LinkedIn tab, no API involved.

export const LINKEDIN_SHARE_URL = 'https://www.linkedin.com/feed/?shareActive=true';

export function xIntentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}
