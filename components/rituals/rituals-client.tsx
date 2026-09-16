'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Repeat, Play, Loader2, ToggleLeft, ToggleRight, CheckCircle2, XCircle, Send } from 'lucide-react';

interface LastRun { status: string; at: string }

interface Ritual {
  id: string;
  name: string;
  schedule: string;
  description: string;
  enabled: boolean;
  lastRun: LastRun | null;
}

interface SystemJob {
  jobName: string;
  name: string;
  schedule: string;
  description: string;
  lastRun: LastRun | null;
}

interface RitualsData {
  telegramLinked: boolean;
  rituals: Ritual[];
  systemJobs: SystemJob[];
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function LastRunLine({ lastRun }: { lastRun: LastRun | null }) {
  if (!lastRun) return <p className="text-xs text-muted-foreground mt-2">Has not run yet.</p>;
  const ok = lastRun.status === 'success';
  return (
    <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
      {ok
        ? <CheckCircle2 size={12} className="text-[#529E63]" />
        : <XCircle size={12} className="text-[#E03E3E]" />}
      Last ran {timeAgo(lastRun.at)} · {lastRun.status}
    </p>
  );
}

export function RitualsClient() {
  const [data, setData] = useState<RitualsData | null>(null);
  const [trying, setTrying] = useState<string | null>(null);
  const [tryResult, setTryResult] = useState<Record<string, { preview: string | null; sentToTelegram: boolean; reason?: string }>>({});

  useEffect(() => {
    fetch('/api/rituals')
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  async function toggle(ritual: Ritual) {
    if (!data) return;
    const enabled = !ritual.enabled;
    setData({
      ...data,
      rituals: data.rituals.map(r => r.id === ritual.id ? { ...r, enabled } : r),
    });
    await fetch('/api/rituals', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ritual: ritual.id, enabled }),
    }).catch(() => {});
  }

  async function tryNow(ritual: Ritual) {
    if (trying) return;
    setTrying(ritual.id);
    setTryResult(prev => ({ ...prev, [ritual.id]: { preview: null, sentToTelegram: false } }));
    try {
      const res = await fetch('/api/rituals/try', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ritual: ritual.id }),
      });
      const json = await res.json();
      setTryResult(prev => ({
        ...prev,
        [ritual.id]: {
          preview: json.preview ?? null,
          sentToTelegram: !!json.sentToTelegram,
          reason: json.reason,
        },
      }));
    } catch {
      setTryResult(prev => ({ ...prev, [ritual.id]: { preview: null, sentToTelegram: false, reason: 'error' } }));
    } finally {
      setTrying(null);
    }
  }

  if (!data) {
    return (
      <div className="p-8 lg:p-10 w-full">
        <h1 className="text-2xl font-semibold tracking-tight">Rituals</h1>
        <p className="text-sm text-muted-foreground mt-1">Loading…</p>
      </div>
    );
  }

  return (
    <div className="p-8 lg:p-10 w-full max-w-4xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rituals</h1>
          <p className="text-sm text-muted-foreground mt-1">Things Lore does when you are not looking.</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[#2383E2] bg-[#2383E2]/10 border border-[#2383E2]/20 px-3 py-1.5 rounded-md">
          <Repeat size={12} />
          On schedule
        </div>
      </div>

      {!data.telegramLinked && (
        <div className="mb-6 text-sm text-muted-foreground bg-accent/50 border border-border rounded-lg px-4 py-3">
          Rituals arrive on Telegram. <Link href="/settings" className="text-foreground underline underline-offset-2">Link your Telegram in settings</Link> to receive them. You can still preview them here.
        </div>
      )}

      <div className="space-y-4 mb-10">
        {data.rituals.map(ritual => {
          const result = tryResult[ritual.id];
          return (
            <div key={ritual.id} className="border border-border rounded-xl p-5 bg-card">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-sm font-semibold">{ritual.name}</h2>
                    <span className="text-[11px] text-muted-foreground bg-accent px-2 py-0.5 rounded">{ritual.schedule}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1.5">{ritual.description}</p>
                  <LastRunLine lastRun={ritual.lastRun} />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => tryNow(ritual)}
                    disabled={trying !== null}
                    className="flex items-center gap-1.5 text-xs font-medium border border-border rounded-md px-2.5 py-1.5 hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    {trying === ritual.id
                      ? <><Loader2 size={12} className="animate-spin" /> Running…</>
                      : <><Play size={12} /> Try now</>}
                  </button>
                  <button onClick={() => toggle(ritual)} aria-label={ritual.enabled ? 'Turn off' : 'Turn on'}>
                    {ritual.enabled
                      ? <ToggleRight size={26} className="text-[#529E63]" />
                      : <ToggleLeft size={26} className="text-muted-foreground" />}
                  </button>
                </div>
              </div>

              {result && (result.preview || result.reason) && (
                <div className="mt-4 border-t border-border pt-3">
                  {result.sentToTelegram && (
                    <p className="text-xs text-[#529E63] flex items-center gap-1.5 mb-2">
                      <Send size={11} /> Sent to your Telegram.
                    </p>
                  )}
                  {result.preview ? (
                    <pre className="text-xs text-foreground/90 whitespace-pre-wrap font-sans bg-accent/40 rounded-lg p-3.5 max-h-72 overflow-y-auto">{result.preview}</pre>
                  ) : result.reason === 'nothing-to-say' ? (
                    <p className="text-xs text-muted-foreground">Quiet right now. Nothing worth a ping, so Lore stays silent instead of padding.</p>
                  ) : result.reason === 'no-brand' ? (
                    <p className="text-xs text-muted-foreground">No active brand yet. Finish onboarding first.</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Could not run right now. Try again in a minute.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mb-3">
        <h2 className="text-sm font-semibold">System activity</h2>
        <p className="text-xs text-muted-foreground mt-0.5">The background work that keeps the learning loop honest. Always on.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {data.systemJobs.map(job => (
          <div key={job.jobName} className="border border-border rounded-lg p-4 bg-card/50">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold">{job.name}</h3>
              <span className="text-[10px] text-muted-foreground bg-accent px-1.5 py-0.5 rounded">{job.schedule}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{job.description}</p>
            <LastRunLine lastRun={job.lastRun} />
          </div>
        ))}
      </div>
    </div>
  );
}
