import Link from 'next/link';
import { runChecks, canRun, type Capability } from '@/lib/setup/checks';
import { setupAccess } from '@/lib/setup/claim';
import { relayTurnedOff } from '@/lib/relay/client';
import { RelayUnlock } from '@/components/setup/relay-unlock';
import { SetupShell, StepHeading } from '@/components/setup/setup-shell';
import { ModelPicker } from '@/components/setup/model-picker';
import { isHosted } from '@/lib/plans';
import { modelReady } from '@/lib/providers';

export const dynamic = 'force-dynamic';

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
      {cap.fix && (cap.id !== 'relay' || relayTurnedOff()) && (
        <pre className="mt-4 max-h-[240px] overflow-auto rounded-md border border-border bg-card p-3.5 text-[12px] leading-relaxed text-foreground/85 whitespace-pre-wrap">
{cap.fix.join('\n')}
        </pre>
      )}
      {cap.id === 'relay' && !relayTurnedOff() && <RelayUnlock />}
    </>
  );
}

function ModelStep({ required }: { required: Capability[] }) {
  const database = required.find((c) => c.id === 'database');

  if (database && database.status !== 'ok') {
    return (
      <>
        <StepHeading eyebrow="Step 2 of 4" title="Connect the database" sub={clean(database.unlocks)} />
        {database.detail && <p className="mt-4 text-sm text-red-600">{database.detail}</p>}
        <Fix cap={database} />
        <div className="mt-6">
          <Link href="/setup?step=model" className={PRIMARY}>Check again</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <StepHeading
        eyebrow="Step 2 of 4"
        title="Connect a model"
        sub="Sign in with your Claude or ChatGPT plan, or paste an API key"
      />
      <ModelPicker />
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
            {open.id !== 'relay' && (
              <div className="mt-6">
                <Link href={`/setup?step=extras&item=${open.id}`} className={SECONDARY}>Check again</Link>
              </div>
            )}
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
        {[...optional].sort((a, b) => Number(b.id === 'relay' && b.status !== 'ok') - Number(a.id === 'relay' && a.status !== 'ok')).map((c) => (
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
  const access = await setupAccess();
  if (access === 'no-database') {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold">Lore cannot reach its database</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Check that Postgres is running and DATABASE_URL in .env.local points at it, then run npm run doctor for details
          </p>
        </div>
      </main>
    );
  }
  if (access === 'no-tables') {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold">The database is empty</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Postgres is running and Lore can reach it. The tables are not there yet, so run this in the
            Lore folder and start Lore again:
          </p>
          <pre className="mt-4 rounded-md border border-border bg-card p-3.5 text-left text-[12.5px]">npm run db:push</pre>
        </div>
      </main>
    );
  }
  if (access === 'open') {
    return (
      <SetupShell current={0}>
        <StepHeading
          eyebrow="Step 1 of 4"
          title="Make this Lore yours"
          sub="Open the setup link printed in the terminal where Lore is running. It creates your account and brings you back here"
        />
        <p className="mt-6 text-sm text-muted-foreground">Lost the link? Stop Lore with Ctrl+C in that terminal and start it again, and it prints a new one:</p>
        <pre className="mt-3 rounded-md border border-border bg-card p-3.5 text-[12.5px]">npm run dev</pre>
      </SetupShell>
    );
  }
  if (access === 'denied') {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Setup is closed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Only the owner of this instance can open setup, so sign in with that account
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
  // Extras only open once a model has really answered a test message, the same
  // gate onboarding uses. The hosted service runs on keys the host set up.
  const modelOk = ready && (isHosted() || (await modelReady()));
  const showExtras = modelOk && step === 'extras';

  return (
    <SetupShell current={showExtras ? 2 : 1}>
      {showExtras ? <ExtrasStep optional={optional} item={item} /> : <ModelStep required={required} />}
    </SetupShell>
  );
}
