'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Choice = 'claude' | 'codex' | 'api';
type KeyProvider = 'anthropic' | 'openai' | 'openrouter';

interface LoginRun {
  done: boolean;
  code: number | null;
  url?: string;
  said?: string;
}

interface Option {
  id: Choice;
  label: string;
  plan: string;
  available: boolean;
  installed: boolean;
  signedIn: boolean | null;
  account?: string;
  said?: string;
  install?: string[];
  login?: string;
  loginRun?: LoginRun | null;
}

interface State {
  options: Option[];
  active: Choice | null;
  pinned: boolean;
  verified: boolean;
  local: boolean;
  canSaveKey: boolean;
}

type Test =
  | { phase: 'idle' }
  | { phase: 'running'; label: string }
  | { phase: 'ok'; ms: number }
  | { phase: 'failed'; error: string };

const KEY_LINKS: Record<KeyProvider, { name: string; url: string; placeholder: string }> = {
  anthropic: { name: 'Anthropic', url: 'https://console.anthropic.com/settings/keys', placeholder: 'sk-ant-...' },
  openai: { name: 'OpenAI', url: 'https://platform.openai.com/api-keys', placeholder: 'sk-...' },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/settings/keys', placeholder: 'sk-or-...' },
};

const DARK_BTN = 'inline-flex items-center justify-center rounded-md bg-foreground px-3.5 py-2 text-[13px] font-medium text-background hover:opacity-90 disabled:opacity-40';

function Code({ text }: { text: string }) {
  const parts = text.split('`');
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px] text-foreground">{p}</code> : <span key={i}>{p}</span>))}
    </>
  );
}

function CopyLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-[12px]">{command}</code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(command).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
        }}
        className="shrink-0 text-[12px] text-muted-foreground hover:text-foreground"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

async function post(body: object): Promise<Record<string, unknown> & { ok?: boolean; error?: string }> {
  const r = await fetch('/api/setup/model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ error: 'The server sent back something unreadable' }));
}

export function ModelPicker() {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [test, setTest] = useState<Test>({ phase: 'idle' });
  const [busy, setBusy] = useState<string | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyProvider, setKeyProvider] = useState<KeyProvider>('anthropic');
  const [keyValue, setKeyValue] = useState('');
  const [signingIn, setSigningIn] = useState<Choice | null>(null);
  const first = useRef(true);

  const load = useCallback(async (recheck = false): Promise<State | null> => {
    try {
      const r = await fetch(recheck ? '/api/setup/model?recheck=1' : '/api/setup/model');
      const data = (await r.json()) as State & { error?: string };
      if (!r.ok) throw new Error(data.error ?? 'Could not load the model settings');
      setState(data);
      setLoadError(null);
      return data;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the model settings');
      return null;
    }
  }, []);

  const runTest = useCallback(async (label: string) => {
    setTest({ phase: 'running', label });
    try {
      const r = await post({ action: 'test' });
      if (r.ok) setTest({ phase: 'ok', ms: Number(r.ms) || 0 });
      else setTest({ phase: 'failed', error: r.error ?? 'The model did not answer' });
    } catch {
      setTest({ phase: 'failed', error: 'Could not reach this server. Check it is still running' });
    }
    await load();
  }, [load]);

  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    load().then((data) => {
      if (!data) return;
      if (data.verified) setTest({ phase: 'ok', ms: 0 });
      else if (data.active && data.options.find((o) => o.id === data.active)?.available) {
        void runTest(data.options.find((o) => o.id === data.active)!.label);
      }
    });
  }, [load, runTest]);

  // While a browser sign-in is open, keep asking the CLI until it says yes.
  useEffect(() => {
    if (!signingIn) return;
    const timer = setInterval(async () => {
      const data = await load();
      const o = data?.options.find((x) => x.id === signingIn);
      if (!o) return;
      if (o.signedIn) {
        setSigningIn(null);
        await use(o);
      } else if (o.loginRun?.done) {
        setSigningIn(null);
      }
    }, 2500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signingIn, load]);

  async function use(o: Option) {
    if (!state || state.pinned) return;
    setBusy(o.id);
    setTest({ phase: 'idle' });
    await post({ action: 'use', backend: o.id });
    setState((prev) => (prev ? { ...prev, active: o.id, verified: false } : prev));
    setBusy(null);
    await runTest(o.label);
  }

  async function signIn(o: Option) {
    setBusy(`login-${o.id}`);
    const r = await post({ action: 'login', backend: o.id });
    setBusy(null);
    if (r.error) {
      setTest({ phase: 'failed', error: r.error });
      return;
    }
    setSigningIn(o.id);
    await load();
  }

  async function saveKey(e: React.FormEvent) {
    e.preventDefault();
    setBusy('key');
    setTest({ phase: 'running', label: KEY_LINKS[keyProvider].name });
    const r = await post({ action: 'key', provider: keyProvider, key: keyValue });
    setBusy(null);
    if (r.ok) {
      setKeyValue('');
      setKeyOpen(false);
      setTest({ phase: 'ok', ms: Number(r.ms) || 0 });
    } else {
      setTest({ phase: 'failed', error: r.error ?? 'The key did not work' });
    }
    await load();
  }

  if (loadError) return <p className="mt-6 text-sm text-red-600">{loadError}</p>;
  if (!state) return <p className="mt-6 text-sm text-muted-foreground">Checking for Claude Code and Codex on this computer</p>;

  return (
    <div className="mt-7">
      <div className="space-y-2.5" role="radiogroup" aria-label="Model">
        {state.options.map((o) => {
          const on = state.active === o.id;
          const selectable = o.available && !state.pinned && busy === null && test.phase !== 'running';
          const status = on && test.phase === 'ok' ? 'In use'
            : o.id === 'api' ? (o.available ? 'Key saved' : 'No key')
              : !o.installed ? 'Not installed'
                : o.signedIn === false ? 'Not signed in'
                  : o.signedIn ? 'Signed in' : 'Could not check';
          const loggingIn = signingIn === o.id || (o.loginRun && !o.loginRun.done);

          return (
            <div key={o.id} className={`rounded-lg border bg-card transition-colors ${on ? 'border-foreground' : 'border-border'}`}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!selectable && !(o.id === 'api' && state.canSaveKey)}
                onClick={() => {
                  if (o.id === 'api' && (!o.available || on)) { setKeyOpen((v) => !v); return; }
                  if (selectable && !on) void use(o);
                  else if (selectable && on && test.phase !== 'ok') void runTest(o.label);
                }}
                className="w-full px-4 py-3.5 text-left disabled:cursor-default"
              >
                <span className="flex items-center gap-3">
                  <span className={`grid size-4 shrink-0 place-items-center rounded-full border ${on ? 'border-foreground' : 'border-border'}`}>
                    {on && <span className="size-2 rounded-full bg-foreground" />}
                  </span>
                  <span className="text-sm font-medium">{o.label}</span>
                  <span className={`ml-auto text-[11px] ${o.signedIn === false && o.installed ? 'text-amber-700' : 'text-muted-foreground'}`}>{status}</span>
                </span>
                <span className="mt-1 block pl-7 text-[12.5px] text-muted-foreground">
                  {o.id !== 'api' && o.signedIn && o.account ? `Signed in with ${o.account}` : o.id === 'api' && o.account ? o.account : o.plan}
                </span>
              </button>

              {o.id !== 'api' && !o.installed && (
                <div className="space-y-2 px-4 pb-3.5 pl-11">
                  {o.install?.map((c) => <CopyLine key={c} command={c} />)}
                  <p className="text-[12px] text-muted-foreground">
                    Run {o.install && o.install.length > 1 ? 'one of these' : 'this'} in a terminal, then{' '}
                    <button type="button" onClick={() => void load(true)} className="underline underline-offset-2 hover:text-foreground">check again</button>
                  </p>
                </div>
              )}

              {o.id !== 'api' && o.installed && o.signedIn !== true && (
                <div className="px-4 pb-3.5 pl-11">
                  {o.said && o.said !== 'Not logged in' && !(on && test.phase === 'failed') && <p className="mb-2 text-[12px] text-red-700">{o.label === 'ChatGPT' ? 'Codex' : 'Claude Code'} said: {o.said}</p>}
                  {loggingIn ? (
                    <div className="text-[12.5px] text-muted-foreground">
                      <p>Finish signing in in the browser window that opened. This page picks it up on its own.</p>
                      {o.loginRun?.url && (
                        <p className="mt-1">No window? <a href={o.loginRun.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">Open the sign-in page</a></p>
                      )}
                    </div>
                  ) : state.local ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" onClick={() => void signIn(o)} disabled={busy !== null} className={DARK_BTN}>
                        Sign in with {o.label}
                      </button>
                      <button type="button" onClick={() => void load(true)} className="text-[12px] text-muted-foreground hover:text-foreground">Check again</button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <CopyLine command={o.login ?? ''} />
                      <p className="text-[12px] text-muted-foreground">
                        Run it on the computer Lore runs on, then{' '}
                        <button type="button" onClick={() => void load(true)} className="underline underline-offset-2 hover:text-foreground">check again</button>
                      </p>
                    </div>
                  )}
                  {o.loginRun?.done && o.loginRun.code !== 0 && o.loginRun.said && !loggingIn && (
                    <p className="mt-2 text-[12px] text-red-700">Sign-in did not finish: {o.loginRun.said}</p>
                  )}
                </div>
              )}

              {o.id === 'api' && keyOpen && state.canSaveKey && (
                <form onSubmit={saveKey} className="space-y-2.5 px-4 pb-4 pl-11">
                  <div className="flex gap-1.5" role="tablist" aria-label="Key provider">
                    {(Object.keys(KEY_LINKS) as KeyProvider[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        role="tab"
                        aria-selected={keyProvider === p}
                        onClick={() => setKeyProvider(p)}
                        className={`rounded-md border px-2.5 py-1 text-[12px] ${keyProvider === p ? 'border-foreground text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
                      >
                        {KEY_LINKS[p].name}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      aria-label={`${KEY_LINKS[keyProvider].name} API key`}
                      value={keyValue}
                      onChange={(e) => setKeyValue(e.target.value)}
                      placeholder={KEY_LINKS[keyProvider].placeholder}
                      autoComplete="off"
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button type="submit" disabled={busy !== null || keyValue.trim().length < 20} className={DARK_BTN}>
                      {busy === 'key' ? 'Testing' : 'Save and test'}
                    </button>
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    No key yet? Make one at <a href={KEY_LINKS[keyProvider].url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">{KEY_LINKS[keyProvider].url.replace('https://', '')}</a>. Lore saves it to .env.local on this computer.
                  </p>
                </form>
              )}
            </div>
          );
        })}
      </div>

      {state.pinned && <p className="mt-3 text-xs text-muted-foreground">Chosen by LORE_PROVIDER in .env.local</p>}

      <div className="mt-5 min-h-[44px]">
        {test.phase === 'running' && <p className="text-sm text-muted-foreground">Sending a test message to {test.label}, this takes a few seconds</p>}
        {test.phase === 'ok' && (
          <p className="text-sm text-emerald-700">Connected{test.ms ? `, it answered in ${(test.ms / 1000).toFixed(1)}s` : ''}</p>
        )}
        {test.phase === 'failed' && (
          <div className="rounded-md border border-red-200 bg-red-50/60 px-3.5 py-3 text-sm text-red-700 break-words">
            <Code text={test.error} />
            {state.active && state.options.find((o) => o.id === state.active)?.available && (
              <button type="button" onClick={() => void runTest(state.options.find((o) => o.id === state.active)!.label)} className="ml-2 underline underline-offset-2">Test again</button>
            )}
          </div>
        )}
      </div>

      <div className="mt-4">
        {test.phase === 'ok' ? (
          <Link href="/setup?step=extras" className="inline-flex items-center justify-center rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90">
            Continue
          </Link>
        ) : (
          <button type="button" disabled className="inline-flex items-center justify-center rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background opacity-40">
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
