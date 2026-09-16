'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const REPO_URL = 'https://github.com/veds260/lore';

interface Status {
  credits: number;
  granted: number;
  unlocked: boolean;
  x: string | null;
  github: string | null;
  githubRequired: boolean;
  followHandle: string;
}

type Note = { text: string; error: boolean } | null;

async function call<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('/api/setup/relay/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Something went wrong (${res.status})`);
  return data;
}

function StepDot({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-medium ${
        done ? 'bg-emerald-500 text-white' : 'bg-foreground text-background'
      }`}
    >
      {done ? '✓' : n}
    </span>
  );
}

const DARK_BTN = 'inline-flex items-center gap-2 rounded-md bg-[#0F1419] px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50';
const LIGHT_BTN = 'inline-flex items-center gap-2 rounded-md border border-border bg-card px-3.5 py-2 text-sm hover:bg-accent disabled:opacity-50';

export function RelayUnlock() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [device, setDevice] = useState<{ userCode: string; verificationUri: string; interval: number } | null>(null);
  const [ghNote, setGhNote] = useState<Note>(null);
  const [ghBusy, setGhBusy] = useState(false);
  const polling = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [handle, setHandle] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [xNote, setXNote] = useState<Note>(null);
  const [xBusy, setXBusy] = useState(false);

  function loadStatus(): Promise<void> {
    return fetch('/api/setup/relay/unlock')
      .then(async (res) => {
        const data = (await res.json()) as Status & { error?: string };
        if (!res.ok) throw new Error(data.error ?? 'Could not reach the shared relay');
        setStatus(data);
        setLoadError(null);
        if (data.unlocked) router.refresh();
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Could not reach the shared relay'));
  }
  const refresh = loadStatus;

  useEffect(() => {
    const timer = polling;
    fetch('/api/setup/relay/unlock')
      .then(async (res) => {
        const data = (await res.json()) as Status & { error?: string };
        if (!res.ok) throw new Error(data.error ?? 'Could not reach the shared relay');
        setStatus(data);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Could not reach the shared relay'));
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  function poll(interval: number) {
    if (polling.current) clearTimeout(polling.current);
    polling.current = setTimeout(async () => {
      try {
        const r = await call<{ state: string; login?: string }>('github-poll');
        if (r.state === 'pending') return poll(interval);
        setDevice(null);
        if (r.state === 'not_starred') {
          setGhNote({ text: `Signed in as ${r.login}, but the repo is not starred yet. Star it, then check again`, error: true });
        } else {
          setGhNote(null);
          await refresh();
        }
      } catch (err) {
        setDevice(null);
        setGhNote({ text: err instanceof Error ? err.message : 'GitHub check failed', error: true });
      }
    }, interval * 1000);
  }

  async function githubStart() {
    setGhBusy(true);
    setGhNote(null);
    try {
      const d = await call<{ userCode: string; verificationUri: string; interval: number }>('github-start');
      setDevice(d);
      poll(d.interval);
    } catch (err) {
      setGhNote({ text: err instanceof Error ? err.message : 'Could not start GitHub sign-in', error: true });
    } finally {
      setGhBusy(false);
    }
  }

  async function githubRecheck() {
    setGhBusy(true);
    setGhNote(null);
    poll(0.1);
    setTimeout(() => setGhBusy(false), 1500);
  }

  async function xStart(e: React.FormEvent) {
    e.preventDefault();
    setXBusy(true);
    setXNote(null);
    try {
      const r = await call<{ code: string; handle: string }>('x-start', { handle });
      setCode(r.code);
      setHandle(r.handle);
    } catch (err) {
      setXNote({ text: err instanceof Error ? err.message : 'Could not start', error: true });
    } finally {
      setXBusy(false);
    }
  }

  async function xVerify() {
    setXBusy(true);
    setXNote(null);
    try {
      await call('x-verify');
      setCode(null);
      await refresh();
    } catch (err) {
      setXNote({ text: err instanceof Error ? err.message : 'Could not verify', error: true });
    } finally {
      setXBusy(false);
    }
  }

  if (loadError) return <p className="mt-6 text-sm text-red-600">{loadError}</p>;
  if (!status) return <p className="mt-6 text-sm text-muted-foreground">Checking the relay</p>;

  if (status.unlocked) {
    return (
      <p className="mt-6 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-3 text-sm">
        Unlocked, {status.credits} of {status.granted} credits left
      </p>
    );
  }

  const ghDone = !status.githubRequired || Boolean(status.github);
  const xDone = Boolean(status.x);
  let n = 0;

  return (
    <div className="mt-6 space-y-6">
      {status.githubRequired && (
        <div className="flex gap-3">
          <StepDot n={++n} done={ghDone} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{ghDone ? `Starred on GitHub as ${status.github}` : 'Star Lore on GitHub'}</p>
            {!ghDone && (
              <>
                {!device ? (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={LIGHT_BTN}>Star the repo</a>
                    <button onClick={ghNote?.error && ghNote.text.includes('not starred') ? githubRecheck : githubStart} disabled={ghBusy} className={DARK_BTN}>
                      {ghNote?.error && ghNote.text.includes('not starred') ? 'Check again' : 'Verify with GitHub'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-2.5 rounded-md border border-border bg-card p-3">
                    <p className="text-[13px] text-muted-foreground">Enter this code on GitHub, then come back here</p>
                    <div className="mt-2 flex items-center gap-3">
                      <code className="font-mono text-lg tracking-widest">{device.userCode}</code>
                      <a href={device.verificationUri} target="_blank" rel="noopener noreferrer" className={DARK_BTN}>Open GitHub</a>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">Waiting for GitHub</p>
                  </div>
                )}
                {ghNote && <p className={`mt-2 text-sm ${ghNote.error ? 'text-red-600' : 'text-emerald-700'}`}>{ghNote.text}</p>}
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <StepDot n={++n} done={xDone} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{xDone ? `Following on X as @${status.x}` : `Follow @${status.followHandle} on X`}</p>
          {!xDone && (
            <>
              {!code ? (
                <>
                  <a
                    href={`https://x.com/intent/follow?screen_name=${status.followHandle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`mt-2.5 ${DARK_BTN}`}
                  >
                    Follow on X
                  </a>
                  <form onSubmit={xStart} className="mt-3 flex gap-2">
                    <div className="flex flex-1 items-center rounded-md border border-border bg-card px-3 focus-within:ring-2 focus-within:ring-ring">
                      <span className="text-sm text-muted-foreground">@</span>
                      <input
                        aria-label="Your X handle"
                        value={handle}
                        onChange={(e) => setHandle(e.target.value.replace(/^@/, ''))}
                        placeholder="yourhandle"
                        autoComplete="off"
                        maxLength={15}
                        required
                        className="w-full bg-transparent px-1 py-2 text-sm outline-none"
                      />
                    </div>
                    <button type="submit" disabled={xBusy || !handle} className={LIGHT_BTN}>{xBusy ? 'Checking' : 'Next'}</button>
                  </form>
                </>
              ) : (
                <div className="mt-2.5 rounded-md border border-border bg-card p-3">
                  <p className="text-[13px] text-muted-foreground">
                    To prove @{handle} is yours, put this code in your X bio or post it. You can remove it once you are verified
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="font-mono text-lg tracking-wider">{code}</code>
                    <button type="button" onClick={() => navigator.clipboard?.writeText(code)} className={LIGHT_BTN}>Copy</button>
                    <a
                      href={`https://x.com/intent/post?text=${encodeURIComponent(`verifying my lore install ${code}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={LIGHT_BTN}
                    >
                      Post it
                    </a>
                    <button type="button" onClick={xVerify} disabled={xBusy} className={DARK_BTN}>{xBusy ? 'Checking' : 'Verify'}</button>
                  </div>
                  <button type="button" onClick={() => { setCode(null); setXNote(null); }} className="mt-2 text-xs text-muted-foreground hover:text-foreground">
                    Use a different handle
                  </button>
                </div>
              )}
              {xNote && <p className={`mt-2 text-sm ${xNote.error ? 'text-red-600' : 'text-emerald-700'}`}>{xNote.text}</p>}
            </>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Each GitHub and X account can unlock free credits once. Reinstalling moves what is left instead of starting over
      </p>
    </div>
  );
}
