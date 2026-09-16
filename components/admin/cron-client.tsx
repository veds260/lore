'use client';

import { useState } from 'react';
import { Play, CheckCircle2, XCircle, Clock, SkipForward, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';

interface CronRun {
  id: string;
  status: string;
  triggeredBy: string;
  result: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: string;
}

interface CronJob {
  name: string;
  label: string;
  description: string;
  schedule: string;
  scheduleLabel: string;
  enabled: boolean;
  runs: CronRun[];
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'success') return <CheckCircle2 size={13} className="text-[#529E63]" />;
  if (status === 'partial') return <CheckCircle2 size={13} className="text-amber-500" />;
  if (status === 'failed') return <XCircle size={13} className="text-destructive" />;
  if (status === 'skipped') return <SkipForward size={13} className="text-muted-foreground" />;
  return <Clock size={13} className="text-muted-foreground" />;
}

function RunRow({ run }: { run: CronRun }) {
  const result = run.result as Record<string, unknown> | null;
  let summary = '';
  if (result) {
    if (result.reason === 'disabled') {
      summary = 'job disabled';
    } else if (result.message) {
      summary = result.message as string;
    } else if (result.totalTwitter != null) {
      const parts: string[] = [];
      if (result.totalTwitter) parts.push(`${result.totalTwitter} tweets`);
      if (result.totalLinkedin) parts.push(`${result.totalLinkedin} LI posts`);
      if (result.totalMatched) parts.push(`${result.totalMatched} drafts matched`);
      summary = parts.join(' · ') || `${result.brands ?? '?'} brands · no new posts`;
    } else if (result.scored != null) {
      summary = `${result.scored} scored${result.failed ? ` · ${result.failed} failed` : ''}${result.total != null ? ` · ${result.total} total` : ''}`;
    } else if (result.consolidated != null) {
      summary = `${result.consolidated} skills consolidated across ${result.brands ?? '?'} brand(s)`;
    } else if (result.pushed != null || result.recipients != null) {
      // Telegram daily / performance
      const recipients = (result.recipients ?? result.pushed) as number;
      summary = `${recipients} recipient${recipients === 1 ? '' : 's'}${result.skipped ? ` · ${result.skipped} skipped` : ''}`;
    } else {
      // Fallback, show something so the row isn't blank
      summary = Object.entries(result).slice(0, 3).map(([k, v]) => `${k}: ${typeof v === 'object' ? '...' : v}`).join(' · ');
    }
  }

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
      <StatusIcon status={run.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-medium capitalize ${
            run.status === 'success' ? 'text-[#529E63]' :
            run.status === 'partial' ? 'text-amber-500' :
            run.status === 'failed' ? 'text-destructive' :
            'text-muted-foreground'
          }`}>
            {run.status}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {run.triggeredBy === 'manual' ? 'Manual trigger' : 'Scheduled'}
          </span>
          {run.durationMs != null && (
            <span className="text-[10px] text-muted-foreground">{run.durationMs}ms</span>
          )}
        </div>
        {summary && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{summary}</p>}
      </div>
      <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(run.createdAt)}</span>
    </div>
  );
}

function JobCard({ job: initialJob }: { job: CronJob }) {
  const [job, setJob] = useState(initialJob);
  const [triggering, setTriggering] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState('');

  async function handleToggle() {
    setToggling(true);
    setError('');
    const next = !job.enabled;
    try {
      const res = await fetch('/api/admin/cron', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: job.name, enabled: next }),
      });
      if (!res.ok) throw new Error('Failed');
      setJob(j => ({ ...j, enabled: next }));
    } catch {
      setError('Toggle failed');
    } finally {
      setToggling(false);
    }
  }

  async function handleTrigger() {
    setTriggering(true);
    setError('');
    try {
      const res = await fetch('/api/admin/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: job.name }),
      });
      // Defensive: response may be empty if the platform timed out before sending a body.
      const raw = await res.text();
      let data: { error?: string; triggered?: boolean; message?: string } = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
      if (!res.ok) throw new Error(data.error ?? `Trigger failed (HTTP ${res.status})`);

      // Trigger is fire-and-forget, the cron writes its own row. Poll the API once
      // a few seconds later to surface the run that landed.
      setError('');
      setTimeout(async () => {
        try {
          const r = await fetch('/api/admin/cron');
          if (!r.ok) return;
          const refreshed = await r.json() as { jobs?: Array<{ name: string; runs: CronRun[] }> };
          const updated = refreshed.jobs?.find(j => j.name === job.name);
          if (updated?.runs?.[0]) {
            setJob(j => ({ ...j, runs: updated.runs.slice(0, 10) }));
          }
        } catch { /* ignore */ }
      }, 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Trigger failed');
    } finally {
      setTriggering(false);
    }
  }

  const lastRun = job.runs[0];

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-start gap-4 border-b border-border">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold text-foreground">{job.label}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              job.enabled
                ? 'bg-[#529E63]/10 text-[#529E63]'
                : 'bg-muted text-muted-foreground'
            }`}>
              {job.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{job.description}</p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {triggering ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Run Now
          </button>
          <button
            onClick={handleToggle}
            disabled={toggling}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title={job.enabled ? 'Disable job' : 'Enable job'}
          >
            {job.enabled
              ? <ToggleRight size={22} className="text-[#529E63]" />
              : <ToggleLeft size={22} />
            }
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="px-5 py-3 flex items-center gap-6 border-b border-border bg-muted/30">
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Schedule</p>
          <p className="text-xs text-foreground font-mono">{job.schedule}</p>
          <p className="text-[10px] text-muted-foreground">{job.scheduleLabel}</p>
        </div>
        {lastRun && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Last run</p>
            <div className="flex items-center gap-1.5">
              <StatusIcon status={lastRun.status} />
              <p className="text-xs text-foreground">{timeAgo(lastRun.createdAt)}</p>
            </div>
          </div>
        )}
        {!lastRun && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Last run</p>
            <p className="text-xs text-muted-foreground">Never</p>
          </div>
        )}
      </div>

      {/* Run history */}
      <div className="px-5">
        {job.runs.length > 0 ? (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pt-3 pb-1">
              Recent runs
            </p>
            {job.runs.map(run => <RunRow key={run.id} run={run} />)}
          </div>
        ) : (
          <div className="py-8 text-center">
            <p className="text-xs text-muted-foreground">No runs yet</p>
          </div>
        )}
      </div>

      {error && (
        <p className="px-5 pb-3 text-xs text-destructive">{error}</p>
      )}
      {triggering && !error && (
        <p className="px-5 pb-3 text-xs text-muted-foreground">Job started in background. Refresh in a few seconds to see the result.</p>
      )}
    </div>
  );
}

export function CronClient({ jobs }: { jobs: CronJob[] }) {
  return (
    <>
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Cron Jobs</h2>
        <div className="space-y-4">
          {jobs.map(job => <JobCard key={job.name} job={job} />)}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Cron Schedule</h2>
        <div className="border border-border rounded-lg bg-card px-5 py-4 space-y-5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Jobs run via{' '}
            <span className="font-medium text-foreground">GitHub Actions</span>{' '}
            (<code className="text-[11px] bg-muted px-1 py-0.5 rounded">.github/workflows/cron.yml</code>).
            Secrets <code className="text-[11px] bg-muted px-1 py-0.5 rounded">LORE_URL</code> and{' '}
            <code className="text-[11px] bg-muted px-1 py-0.5 rounded">CRON_SECRET</code> are set in GitHub repo secrets.
            Deploys don&apos;t affect the schedule. GitHub triggers independently.
            You can also trigger any job manually from the GitHub Actions UI.
          </p>

          {[
            {
              label: 'Daily Content Sync',
              endpoint: 'daily-sync',
              schedule: '0 4 * * *',
              note: 'Daily at 4am UTC: syncs Twitter/LinkedIn + matches drafts',
            },
            {
              label: 'Weekly Skill Synthesis',
              endpoint: 'consolidate-skills',
              schedule: '0 0 * * 0',
              note: 'Sundays midnight UTC: consolidates skills into voice doc',
            },
            {
              label: 'Draft Quality Scorer',
              endpoint: 'score-drafts',
              schedule: '0 */6 * * *',
              note: 'Every 6 hours: auto-scores unscored drafts',
            },
            {
              label: 'Telegram Daily Push',
              endpoint: 'telegram-daily',
              schedule: '0 3 * * *',
              note: 'Daily at 3am UTC: sends 3 fresh idea suggestions to each connected user',
            },
            {
              label: 'Telegram Performance Pings',
              endpoint: 'telegram-performance',
              schedule: '0 14 * * *',
              note: 'Daily at 2pm UTC: flags high-performing posts and offers follow-ups',
            },
          ].map(job => (
            <div key={job.endpoint} className="border border-border rounded-md p-3 space-y-2">
              <p className="text-xs font-semibold text-foreground">{job.label}</p>
              <p className="text-[11px] text-muted-foreground">{job.note}</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Command</p>
                  <pre className="text-[11px] bg-muted rounded-md px-3 py-2 overflow-x-auto text-foreground font-mono whitespace-pre-wrap">
                    {`curl -s -X POST $LORE_URL/api/cron/${job.endpoint} -H "x-cron-secret: $CRON_SECRET"`}
                  </pre>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Schedule</p>
                  <pre className="text-[11px] bg-muted rounded-md px-3 py-2 text-foreground font-mono">{job.schedule}</pre>
                </div>
              </div>
            </div>
          ))}

          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Required env vars (all services)</p>
            <pre className="text-[11px] bg-muted rounded-md px-3 py-2 text-foreground font-mono">
              {`LORE_URL=https://your-app.railway.app\nCRON_SECRET=<same value as main service>`}
            </pre>
          </div>
        </div>
      </section>
    </>
  );
}
