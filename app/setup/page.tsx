import Link from 'next/link';
import { runChecks, canRun, type Capability } from '@/lib/setup/checks';
import { ownerExists } from '@/lib/setup/claim';
import { auth } from '@/lib/auth';
import { relayTurnedOff } from '@/lib/relay/client';
import { RelayConnectButton } from '@/components/setup/relay-connect-button';
import { SetupShell, StepHeading } from '@/components/setup/setup-shell';

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

const clean = (t: string) => t.replace(/\.$/, '');

const PRIMARY = 'inline-flex items-center justify-center rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90';
const SECONDARY = 'inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2.5 text-sm text-foreground hover:bg-accent';

function Dot({ status }: { status: Capability['status'] }) {
  const tone = status === 'ok' ? 'bg-emerald-500' : status === 'broken' ? 'bg-red-500' : status === 'unknown' ? 'bg-amber-400' : 'bg-stone-300';
  return <span className={`size-2 shrink-0 rounded-full ${tone}`} />;
}

const WORD: Record<Capability['status'], string> = {
  ok: 'On',
  missing: 'Off',
  broken: 'Not working',
  unknown: 'Could not check',
};

function Fix({ cap }: { cap: Capability }) {
  return (
    <>
      {cap.fix && (
        <pre className="mt-4 max-h-[240px] overflow-auto rounded-md border border-border bg-card p-3.5 text-[12px] leading-relaxed text-foreground/85 whitespace-pre-wrap">
{cap.fix.join('\n')}
        </pre>
      )}
      {cap.id === 'relay' && !relayTurnedOff() && <RelayConnectButton />}
    </>
  );
}

function ModelStep({ required, ready }: { required: Capability[]; ready: boolean }) {
  const todo = required.filter((c) => c.status !== 'ok');

  if (!ready) {
    const cap = todo[0];
    return (
      <>
        <StepHeading
          eyebrow="Step 2 of 4"
          title={cap.id === 'database' ? 'Connect the database' : 'Connect a model'}
          sub={clean(cap.unlocks)}
        />
        {cap.detail && <p className="mt-4 text-sm text-red-600">{cap.detail}</p>}
        <Fix cap={cap} />
        <div className="mt-6 flex items-center gap-3">
          <Link href="/setup?step=model" className={PRIMARY}>Check again</Link>
          {todo.length > 1 && <span className="text-[13px] text-muted-foreground">{todo.length - 1} more after this</span>}
        </div>
      </>
    );
  }

  return (
    <>
      <StepHeading eyebrow="Step 2 of 4" title="Your model is connected" sub="Lore found everything it needs to write" />
      <div className="mt-7 rounded-lg border border-border bg-card divide-y divide-border">
        {required.map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3">
            <Dot status={c.status} />
            <span className="text-sm font-medium">{c.label}</span>
            <span className="ml-auto truncate text-[13px] text-muted-foreground">{c.detail}</span>
          </div>
        ))}
      </div>
      <div className="mt-7">
        <Link href="/setup?step=extras" className={PRIMARY}>Continue</Link>
      </div>
    </>
  );
}

function ExtrasStep({ optional, item }: { optional: Capability[]; item?: string }) {
  const open = optional.find((c) => c.id === item);

  if (open) {
    return (
      <>
        <Link href="/setup?step=extras" className="text-[13px] text-muted-foreground hover:text-foreground">
          ← All extras
        </Link>
        <div className="mt-5 flex items-center gap-2.5">
          <Dot status={open.status} />
          <span className="text-[12px] text-muted-foreground">{WORD[open.status]}</span>
        </div>
        <h1 className="mt-2 text-[28px] leading-tight font-semibold tracking-tight">{open.label}</h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">{clean(open.unlocks)}</p>
        {open.status === 'ok' ? (
          <p className="mt-5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-3 text-sm">
            Working, {open.detail}
          </p>
        ) : (
          <>
            {open.detail && <p className="mt-4 text-sm text-muted-foreground">{open.detail}</p>}
            <Fix cap={open} />
            <div className="mt-6">
              <Link href={`/setup?step=extras&item=${open.id}`} className={SECONDARY}>Check again</Link>
            </div>
          </>
        )}
      </>
    );
  }

  const on = optional.filter((c) => c.status === 'ok').length;
  return (
    <>
      <StepHeading
        eyebrow="Step 3 of 4"
        title="Turn on extras"
        sub={`${on} of ${optional.length} are on. Skip any of them, this page is here whenever you want to add one`}
      />
      <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {optional.map((c) => (
          <Link
            key={c.id}
            href={`/setup?step=extras&item=${c.id}`}
            className="group rounded-lg border border-border bg-card px-4 py-3.5 hover:border-foreground/30 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Dot status={c.status} />
              <span className="text-sm font-medium">{c.label}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{WORD[c.status]}</span>
            </span>
            <span className="mt-1.5 block text-[12.5px] leading-snug text-muted-foreground line-clamp-2">{clean(c.unlocks)}</span>
          </Link>
        ))}
      </div>
      <div className="mt-7 flex items-center gap-4">
        <Link href="/onboarding" className={PRIMARY}>Continue to your profile</Link>
        <Link href="/setup?step=model" className="text-[13px] text-muted-foreground hover:text-foreground">Back</Link>
      </div>
    </>
  );
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; item?: string }>;
}) {
  if ((await gate()) === 'denied') {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Setup is closed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This instance already has an owner, so sign in to see its configuration
          </p>
          <Link href="/login" className="mt-6 inline-block rounded-md bg-foreground px-4 py-2 text-sm text-background">
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  const { step, item } = await searchParams;
  const caps = await runChecks();
  const ready = canRun(caps);
  const required = caps.filter((c) => c.required);
  const optional = caps.filter((c) => !c.required);
  const showExtras = ready && step === 'extras';

  return (
    <SetupShell current={showExtras ? 2 : 1}>
      {showExtras ? <ExtrasStep optional={optional} item={item} /> : <ModelStep required={required} ready={ready} />}
    </SetupShell>
  );
}
