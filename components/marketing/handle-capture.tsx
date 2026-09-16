'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// The hero field takes the handle Lore will read.

export function HandleCapture({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const router = useRouter();
  const [handle, setHandle] = useState('');
  const dark = tone === 'dark';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = handle.trim().replace(/^@/, '').replace(/\s/g, '');
    try {
      if (clean) window.localStorage.setItem('lore:pending-handle', clean);
    } catch {
      // private mode, the handle just does not carry over
    }
    router.push(clean ? `/login?handle=${encodeURIComponent(clean)}` : '/login');
  }

  return (
    <form onSubmit={submit} className="w-full max-w-md">
      <div
        className={`flex items-center gap-2 rounded-lg border pl-3.5 pr-1.5 py-1.5 transition-colors ${
          dark
            ? 'border-white/20 bg-white/5 focus-within:border-white/40'
            : 'border-border bg-card focus-within:border-muted-foreground'
        }`}
      >
        <span className={`text-sm ${dark ? 'text-white/40' : 'text-muted-foreground'}`}>@</span>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="yourhandle"
          aria-label="Your X or LinkedIn handle"
          autoComplete="off"
          spellCheck={false}
          className={`flex-1 min-w-0 bg-transparent text-sm outline-none ${
            dark ? 'text-white placeholder:text-white/35' : 'text-foreground placeholder:text-muted-foreground/70'
          }`}
        />
        <span className={`hidden sm:block font-mono text-[10px] ${dark ? 'text-white/30' : 'text-muted-foreground/70'}`}>
          Press Enter
        </span>
        <button
          type="submit"
          className={`shrink-0 rounded-md px-3.5 py-2 text-sm font-medium transition-opacity hover:opacity-90 ${
            dark ? 'bg-white text-[#1A1917]' : 'bg-primary text-primary-foreground'
          }`}
        >
          Read my posts
        </button>
      </div>
      <p className={`mt-2.5 text-xs ${dark ? 'text-white/45' : 'text-muted-foreground'}`}>
        Google sign-in first, then Lore starts reading. No card
      </p>
    </form>
  );
}
