'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RelayConnectButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function connect() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/setup/relay', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { credits?: number; error?: string };
      if (!res.ok) {
        setMessage({ text: data.error ?? `Could not connect (${res.status})`, error: true });
      } else {
        setMessage({ text: `Connected, ${data.credits ?? 0} credits to start with.`, error: false });
      }
    } catch {
      setMessage({ text: 'Could not reach this server. Check it is still running.', error: true });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={connect}
        disabled={busy}
        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-60"
      >
        {busy ? 'Connecting...' : 'Connect to the shared relay'}
      </button>
      {message && (
        <p className={`mt-2 text-sm ${message.error ? 'text-red-600' : 'text-muted-foreground'}`}>{message.text}</p>
      )}
    </div>
  );
}
