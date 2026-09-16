'use client';

import { useEffect, useState } from 'react';

// Returns the platform-appropriate mod-key glyph for keyboard-shortcut labels:
//   - macOS / iPadOS → "⌘"
//   - Windows / Linux / everywhere else → "Ctrl"
// Renders an empty string on the server so SSR matches client and we don't
// flash the wrong label.
export function useModKey(): string {
  const [mod, setMod] = useState('');
  useEffect(() => {
    Promise.resolve()
      .then(() => {
        if (typeof navigator === 'undefined') return;
        const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
          ?? navigator.platform
          ?? '';
        const isMacLike = /mac|iphone|ipad|ipod/i.test(platform);
        setMod(isMacLike ? '⌘' : 'Ctrl');
      })
      .catch(() => {});
  }, []);
  return mod;
}

// Convenience: full "⌘ Enter" / "Ctrl + Enter" style label.
export function ModKey({ keys = 'Enter' }: { keys?: string }) {
  const mod = useModKey();
  if (!mod) return null; // suppress SSR flash
  return <>{mod === '⌘' ? `${mod} ${keys}` : `${mod} + ${keys}`}</>;
}
