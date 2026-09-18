import Link from 'next/link';
import { LoreLogo } from '@/components/layout/logo';

/**
 * Shell for /terms and /privacy. Plain text on a plain page, so the two read the
 * same way and neither needs its own layout.
 */
export function LegalPage({
  title,
  updated,
  summary,
  children,
}: {
  title: string;
  updated: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <nav className="w-full max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
        <Link href="/home" aria-label="Lore home">
          <LoreLogo />
        </Link>
        <div className="flex items-center gap-5 text-sm text-muted-foreground">
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
        </div>
      </nav>

      <main className="w-full max-w-3xl mx-auto px-6 pb-24 pt-6">
        <h1 className="text-[2rem] font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">Last updated {updated}</p>
        <p className="mt-6 rounded-md border border-border bg-card px-4 py-3 text-[14px] leading-relaxed text-foreground/80">
          {summary}
        </p>
        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-foreground/85">{children}</div>
      </main>
    </div>
  );
}

export function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[17px] font-semibold text-foreground">{heading}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">{children}</code>
  );
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2 pl-5 list-disc marker:text-muted-foreground">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
