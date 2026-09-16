'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RelayUnlock({ followHandle }: { followHandle: string }) {
  const router = useRouter();
  const [handle, setHandle] = useState('');
  const [followed, setFollowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/setup/relay', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle }),
      });
      const data = (await res.json().catch(() => ({}))) as { credits?: number; error?: string };
      if (!res.ok) {
        setMessage({ text: data.error ?? `Could not unlock (${res.status})`, error: true });
      } else {
        setMessage({ text: `Unlocked, you have ${data.credits ?? 0} credits`, error: false });
        router.refresh();
      }
    } catch {
      setMessage({ text: 'Could not reach this server. Check it is still running', error: true });
    } finally {
      setBusy(false);
    }
  }

  const step = 'grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-medium';

  return (
    <div className="mt-6 space-y-5">
      <div className="flex gap-3">
        <span className={`${step} ${followed ? 'bg-emerald-500 text-white' : 'bg-foreground text-background'}`}>{followed ? '✓' : 1}</span>
        <div className="flex-1">
          <p className="text-sm font-medium">Follow @{followHandle} on X</p>
          <a
            href={`https://x.com/intent/follow?screen_name=${followHandle}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setFollowed(true)}
            className="mt-2.5 inline-flex items-center gap-2 rounded-md bg-[#0F1419] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden>
              <path d="M12.6 0h2.45l-5.36 6.12L16 16h-4.94l-3.87-5.06L2.76 16H.31l5.73-6.55L0 0h5.06l3.5 4.63L12.6 0zm-.86 14.55h1.36L4.32 1.38H2.87l8.87 13.17z" />
            </svg>
            Follow on X
          </a>
        </div>
      </div>

      <form onSubmit={unlock} className="flex gap-3">
        <span className={`${step} bg-foreground text-background`}>2</span>
        <div className="flex-1">
          <label htmlFor="relay-handle" className="text-sm font-medium">Your X handle</label>
          <div className="mt-2.5 flex gap-2">
            <div className="flex flex-1 items-center rounded-md border border-border bg-card px-3 focus-within:ring-2 focus-within:ring-ring">
              <span className="text-sm text-muted-foreground">@</span>
              <input
                id="relay-handle"
                value={handle}
                onChange={(e) => setHandle(e.target.value.replace(/^@/, ''))}
                placeholder="yourhandle"
                autoComplete="off"
                maxLength={15}
                required
                className="w-full bg-transparent px-1 py-2 text-sm outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy || !handle}
              className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Checking' : 'Unlock credits'}
            </button>
          </div>
          {message && <p className={`mt-2 text-sm ${message.error ? 'text-red-600' : 'text-emerald-700'}`}>{message.text}</p>}
          <p className="mt-2 text-xs text-muted-foreground">Each X account unlocks credits for one install</p>
        </div>
      </form>
    </div>
  );
}
