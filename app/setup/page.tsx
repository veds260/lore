import Link from 'next/link';
import { runChecks, canRun, type Capability } from '@/lib/setup/checks';
import { ownerExists } from '@/lib/setup/claim';
import { auth } from '@/lib/auth';
import { relayTurnedOff } from '@/lib/relay/client';
import { RelayConnectButton } from '@/components/setup/relay-connect-button';

export const dynamic = 'force-dynamic';

// Reachable before sign-in only while the instance is unowned. Once an owner
// exists it needs a session, so a public deploy cannot have its configuration
// read by a stranger.
async function gate(): Promise<'open' | 'denied'> {
  const owned = await ownerExists();
  if (!owned) return 'open';
  const session = await auth();
  return session?.user ? 'open' : 'denied';
}

const DOT: Record<Capability['status'], string> = {
  ok: 'bg-emerald-500',
  missing: 'bg-stone-300',
  broken: 'bg-red-500',
  unknown: 'bg-amber-400',
};

const WORD: Record<Capability['status'], string> = {
  ok: 'ready',
  missing: 'not set up',
  broken: 'not working',
  unknown: 'could not check',
};

function Row({ cap }: { cap: Capability }) {
  return (
    <div className="border-b border-border last:border-b-0 py-5">
      <div className="flex items-baseline gap-3">
        <span className={`size-2 rounded-full shrink-0 translate-y-[-1px] ${DOT[cap.status]}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="font-medium">
              {cap.label}
              {!cap.required && <span className="ml-2 text-xs text-muted-foreground">optional</span>}
            </h3>
            <span className="text-xs text-muted-foreground shrink-0">{WORD[cap.status]}</span>
          </div>

          {cap.detail && <p className="mt-1 text-sm text-muted-foreground">{cap.detail}</p>}

          {cap.status !== 'ok' && (
            <>
              <p className="mt-1 text-sm text-muted-foreground">{cap.unlocks}</p>
              {cap.fix && (
                <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-card p-3 text-[12px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
{cap.fix.join('\n')}
                </pre>
              )}
              {cap.id === 'relay' && !relayTurnedOff() && <RelayConnectButton />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function SetupPage() {
  if ((await gate()) === 'denied') {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Setup is closed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This instance already has an owner. Sign in to see its configuration.
          </p>
          <Link href="/login" className="mt-6 inline-block rounded-md bg-foreground px-4 py-2 text-sm text-background">
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  const caps = await runChecks();
  const ready = canRun(caps);
  const required = caps.filter((c) => c.required);
  const optional = caps.filter((c) => !c.required);
  const live = optional.filter((c) => c.status === 'ok').length;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Setup</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          {ready ? 'Lore is ready' : 'Two things to finish'}
        </h1>
        <p className="mt-3 text-muted-foreground leading-relaxed">
          {ready
            ? `Everything required is working${live > 0 ? `, and ${live} optional ${live === 1 ? 'feature is' : 'features are'} on` : ''}. This page stays here, so you can come back whenever you add something.`
            : 'Nothing here needs an account with us. Fix what is red, reload this page, and it rechecks itself.'}
        </p>

        {ready && (
          <Link
            href="/onboarding"
            className="mt-7 inline-block rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90"
          >
            Start writing
          </Link>
        )}

        <section className="mt-12">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Required</h2>
          <div className="mt-2">
            {required.map((c) => <Row key={c.id} cap={c} />)}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Optional, turn on what you want
          </h2>
          <div className="mt-2">
            {optional.map((c) => <Row key={c.id} cap={c} />)}
          </div>
        </section>

        <p className="mt-12 text-sm text-muted-foreground">
          The same checks run in your terminal with <code className="font-mono text-[12px]">npm run doctor</code>.
        </p>
      </div>
    </main>
  );
}
