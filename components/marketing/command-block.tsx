'use client';

import { useState } from 'react';

export function CommandBlock({
  command,
  label,
  tone = 'light',
  wrap = false,
}: {
  command: string;
  label?: string;
  tone?: 'light' | 'dark';
  wrap?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const dark = tone === 'dark';

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(command);
      ok = true;
    } catch {
      // Clipboard API needs a secure context and permission. Fall back to a
      // throwaway textarea, which works on http and in older browsers.
      try {
        const el = document.createElement('textarea');
        el.value = command;
        el.setAttribute('readonly', '');
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        ok = document.execCommand('copy');
        document.body.removeChild(el);
      } catch {
        ok = false;
      }
    }
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="w-full">
      {label && (
        <p
          className={`font-mono text-[11px] uppercase tracking-wider mb-2 ${
            dark ? 'text-white/40' : 'text-muted-foreground'
          }`}
        >
          {label}
        </p>
      )}
      <div
        className={`flex items-center gap-3 rounded-lg border pl-4 pr-1.5 py-1.5 ${
          dark ? 'border-white/20 bg-white/5' : 'border-border bg-card'
        }`}
      >
        <span className={`select-none font-mono text-sm ${dark ? 'text-white/35' : 'text-muted-foreground/70'}`}>$</span>
        <code
          className={`flex-1 min-w-0 font-mono text-[11.5px] sm:text-[12.5px] leading-relaxed ${wrap ? 'whitespace-normal' : 'overflow-x-auto whitespace-nowrap'} ${
            dark ? 'text-white' : 'text-foreground'
          }`}
        >
          {wrap
            ? command.split('/').map((part, i, all) => (
                <span key={i}>
                  {part}
                  {i < all.length - 1 && (
                    <>
                      /<wbr />
                    </>
                  )}
                </span>
              ))
            : command}
        </code>
        <button
          onClick={copy}
          aria-label={`Copy command: ${command}`}
          className={`shrink-0 rounded-md px-3 py-2 text-xs font-medium transition-opacity hover:opacity-90 ${
            dark ? 'bg-white text-[#1A1917]' : 'bg-foreground text-background'
          }`}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
