import Link from 'next/link';
import { LoreLogo } from '@/components/layout/logo';

const STEPS = [
  { title: 'Account', note: 'Your login for this install' },
  { title: 'Model', note: 'The AI that does the writing' },
  { title: 'Extras', note: 'Telegram, voice and X, all optional' },
  { title: 'Profile', note: 'Your handle and how you write' },
];

// One fixed screen per step. The rail shows where you are, the right side only
// ever holds the one thing to do next, so nothing on setup needs a scroll.
export function SetupShell({ current, children }: { current: number; children: React.ReactNode }) {
  return (
    <div className="min-h-svh lg:h-svh bg-background text-foreground grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)] content-start lg:content-stretch">
      <aside className="border-b lg:border-b-0 lg:border-r border-border bg-sidebar px-6 py-5 lg:px-8 lg:py-8 flex lg:flex-col gap-6 lg:gap-0 items-center lg:items-stretch">
        <Link href="/home" aria-label="Lore home" className="shrink-0">
          <LoreLogo />
        </Link>

        <ol className="min-w-0 flex lg:flex-col gap-4 lg:gap-0 lg:mt-14 overflow-x-auto">
          {STEPS.map((s, i) => {
            const done = i < current;
            const on = i === current;
            return (
              <li key={s.title} className="relative flex gap-3 lg:pb-8 last:pb-0 shrink-0">
                {i < STEPS.length - 1 && (
                  <span className={`hidden lg:block absolute left-[11px] top-7 bottom-1 w-px ${done ? 'bg-emerald-500/50' : 'bg-border'}`} />
                )}
                <span
                  className={`relative grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-medium ${
                    done ? 'bg-emerald-500 text-white' : on ? 'bg-foreground text-background' : 'border border-border bg-card text-muted-foreground'
                  }`}
                >
                  {done ? (
                    <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
                      <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="pt-0.5">
                  <span className={`${on ? 'block' : 'hidden sm:block'} text-[13.5px] ${on ? 'font-medium text-foreground' : done ? 'text-foreground/80' : 'text-muted-foreground'}`}>
                    {s.title}
                  </span>
                  <span className="hidden lg:block mt-0.5 text-[12px] text-muted-foreground">{s.note}</span>
                </span>
              </li>
            );
          })}
        </ol>

        <p className="hidden lg:block mt-auto text-[12px] leading-relaxed text-muted-foreground">
          <code className="font-mono text-[11px]">npm run doctor</code> runs these same checks in your terminal
        </p>
      </aside>

      <main className="flex items-center justify-center px-6 py-10 lg:py-0 min-h-0">
        <div className="w-full max-w-[520px]">{children}</div>
      </main>
    </div>
  );
}

export function StepHeading({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div>
      <p className="text-[12px] font-medium text-muted-foreground">{eyebrow}</p>
      <h1 className="mt-2 text-[28px] leading-tight font-semibold tracking-tight">{title}</h1>
      {sub && <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">{sub}</p>}
    </div>
  );
}
