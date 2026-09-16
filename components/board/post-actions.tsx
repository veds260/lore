'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { LINKEDIN_SHARE_URL, xIntentUrl } from '@/lib/post-intents';

export function PostActions({ text, platform }: { text: string; platform: 'twitter' | 'linkedin' }) {
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function flash(ok: boolean, message: string) {
    setFeedback({ ok, message });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFeedback(null), 2500);
  }

  async function copy(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function handleCopy() {
    const ok = await copy();
    flash(ok, ok ? 'Copied' : 'Could not copy');
  }

  function handlePostLinkedIn() {
    // Start the copy while this tab still has focus, then open LinkedIn in the same click.
    const copied = copy();
    window.open(LINKEDIN_SHARE_URL, '_blank', 'noopener,noreferrer');
    copied.then(ok => flash(ok, ok ? 'Copied, paste it into LinkedIn' : 'Could not copy, copy the text manually'));
  }

  const empty = !text.trim();
  const btn = 'flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors';

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button onClick={handleCopy} disabled={empty} className={`${btn} disabled:opacity-50`}>
        <Copy size={12} /> Copy
      </button>
      {platform === 'twitter' ? (
        <a
          href={empty ? undefined : xIntentUrl(text)}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={empty}
          className={`${btn} ${empty ? 'pointer-events-none opacity-50' : ''}`}
        >
          <ExternalLink size={12} /> Post on X
        </a>
      ) : (
        <button onClick={handlePostLinkedIn} disabled={empty} className={`${btn} disabled:opacity-50`}>
          <ExternalLink size={12} /> Post on LinkedIn
        </button>
      )}
      {feedback && (
        <span className={`text-xs flex items-center gap-1 ${feedback.ok ? 'text-[#529E63]' : 'text-destructive'}`}>
          {feedback.ok && <Check size={12} />} {feedback.message}
        </span>
      )}
    </div>
  );
}
