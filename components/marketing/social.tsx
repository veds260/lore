import Link from 'next/link';

export const GITHUB_URL = 'https://github.com/veds260/lore';
export const X_URL = 'https://x.com/vedsayys';
export const LINKEDIN_URL = 'https://linkedin.com/in/vedaang-singh';

function GithubMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38l-.01-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function XMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M12.6 0h2.45l-5.36 6.12L16 16h-4.94l-3.87-5.06L2.76 16H.31l5.73-6.55L0 0h5.06l3.5 4.63L12.6 0zm-.86 14.55h1.36L4.32 1.38H2.87l8.87 13.17z" />
    </svg>
  );
}

function LinkedinMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M3.6 16H.27V5.32H3.6V16zM1.93 3.86A1.93 1.93 0 110 1.93a1.93 1.93 0 011.93 1.93zM16 16h-3.33v-5.2c0-1.24-.02-2.83-1.73-2.83-1.73 0-2 1.35-2 2.74V16H5.62V5.32h3.19v1.46h.05a3.5 3.5 0 013.15-1.73c3.37 0 3.99 2.22 3.99 5.1V16z" />
    </svg>
  );
}

export function StarButton({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href={GITHUB_URL}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-2 rounded-lg border border-border bg-card text-foreground hover:border-muted-foreground transition-colors ${
        compact ? 'px-3 py-1.5 text-[12px]' : 'px-4 py-2.5 text-sm'
      }`}
    >
      <GithubMark className={compact ? 'size-3.5' : 'size-4'} />
      <span className="font-medium">Star it on GitHub</span>
      <span aria-hidden className="text-[#E9A23B]">
        ★
      </span>
    </Link>
  );
}

export function FollowRow({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const dark = tone === 'dark';
  const base = dark
    ? 'border-white/20 text-white/80 hover:text-white hover:border-white/40'
    : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground';

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Link
        href={X_URL}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors ${base}`}
      >
        <XMark className="size-3.5" />
        Follow on X
      </Link>
      <Link
        href={LINKEDIN_URL}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors ${base}`}
      >
        <LinkedinMark className="size-3.5 text-[#0A66C2]" />
        Follow on LinkedIn
      </Link>
    </div>
  );
}

export { GithubMark, XMark, LinkedinMark };
