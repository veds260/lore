'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Choice = 'claude' | 'codex' | 'api';

interface Option {
  id: Choice;
  label: string;
  plan: string;
  available: boolean;
  howTo: string;
}

interface State {
  options: Option[];
  active: Choice | null;
  pinned: boolean;
  verified: boolean;
}

type Test =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'ok'; provider: string; ms: number }
  | { phase: 'failed'; error: string };

function Code({ text }: { text: string }) {
  const parts = text.split('`');
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px] text-foreground">{p}</code> : <span key={i}>{p}</span>))}
    </>
  );
}

export function ModelPicker() {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [test, setTest] = useState<Test>({ phase: 'idle' });
  const [switching, setSwitching] = useState<Choice | null>(null);
  const autoTested = useRef(false);

  function runTest() {
    setTest({ phase: 'running' });
    fetch('/api/setup/model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test' }) })
      .then((r) => r.json())
      .then((r: { ok: boolean; provider?: string; ms?: number; error?: string }) => {
        setTest(r.ok ? { phase: 'ok', provider: r.provider ?? '', ms: r.ms ?? 0 } : { phase: 'failed', error: r.error ?? 'The model did not answer' });
      })
      .catch(() => setTest({ phase: 'failed', error: 'Could not reach this server. Check it is still running' }));
  }

  function load(thenTest: boolean) {
    fetch('/api/setup/model')
      .then(async (r) => {
        const data = (await r.json()) as State & { error?: string };
        if (!r.ok) throw new Error(data.error ?? 'Could not load the model settings');
        setState(data);
        if (data.verified) setTest({ phase: 'ok', provider: '', ms: 0 });
        else if (thenTest && data.active) runTest();
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Could not load the model settings'));
  }

  useEffect(() => {
    if (autoTested.current) return;
    autoTested.current = true;
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(id: Choice) {
    if (!state || state.pinned || id === state.active) return;
    setSwitching(id);
    setTest({ phase: 'idle' });
    fetch('/api/setup/model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'use', backend: id }) })
      .then(() => {
        setState((s) => (s ? { ...s, active: id, verified: false } : s));
        runTest();
      })
      .finally(() => setSwitching(null));
  }

  if (loadError) return <p className="mt-6 text-sm text-red-600">{loadError}</p>;
  if (!state) return <p className="mt-6 text-sm text-muted-foreground">Looking for Claude and ChatGPT on this machine</p>;

  const none = !state.options.some((o) => o.available);

  return (
    <div className="mt-7">
      <div className="space-y-2.5" role="radiogroup" aria-label="Model">
        {state.options.map((o) => {
          const on = state.active === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!o.available || state.pinned || switching !== null}
              onClick={() => choose(o.id)}
              className={`w-full rounded-lg border px-4 py-3.5 text-left transition-colors ${
                on ? 'border-foreground bg-card' : 'border-border bg-card hover:border-foreground/30'
              } disabled:cursor-default ${!o.available ? 'opacity-70' : ''}`}
            >
              <span className="flex items-center gap-3">
                <span className={`grid size-4 shrink-0 place-items-center rounded-full border ${on ? 'border-foreground' : 'border-border'}`}>
                  {on && <span className="size-2 rounded-full bg-foreground" />}
                </span>
                <span className="text-sm font-medium">{o.label}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">{o.available ? (on ? 'In use' : 'Found') : 'Not set up'}</span>
              </span>
              <span className="mt-1 block pl-7 text-[12.5px] text-muted-foreground">
                {o.available ? o.plan : <Code text={o.howTo} />}
              </span>
            </button>
          );
        })}
      </div>

      {state.pinned && <p className="mt-3 text-xs text-muted-foreground">Chosen by LORE_PROVIDER in .env.local</p>}

      <div className="mt-5 min-h-[44px]">
        {none && (
          <p className="text-sm text-muted-foreground">Set one of these up, then <button type="button" onClick={() => load(true)} className="underline underline-offset-2 hover:text-foreground">check again</button></p>
        )}
        {test.phase === 'running' && <p className="text-sm text-muted-foreground">Sending a test message, this takes a few seconds</p>}
        {test.phase === 'ok' && (
          <p className="text-sm text-emerald-700">
            Connected{test.ms ? `, it answered in ${(test.ms / 1000).toFixed(1)}s` : ''}
          </p>
        )}
        {test.phase === 'failed' && (
          <div className="rounded-md border border-red-200 bg-red-50/60 px-3.5 py-3 text-sm text-red-700">
            <Code text={test.error} />
            <button type="button" onClick={runTest} className="ml-2 underline underline-offset-2">Test again</button>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-4">
        {test.phase === 'ok' ? (
          <Link href="/setup?step=extras" className="inline-flex items-center justify-center rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90">
            Continue
          </Link>
        ) : (
          <button type="button" disabled className="inline-flex items-center justify-center rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background opacity-40">
            Continue
          </button>
        )}
        {test.phase === 'idle' && state.active && !none && (
          <button type="button" onClick={runTest} className="text-[13px] text-muted-foreground hover:text-foreground">Test connection</button>
        )}
      </div>
    </div>
  );
}
