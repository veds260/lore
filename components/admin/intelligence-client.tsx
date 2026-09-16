'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, Clock, AlertTriangle, RefreshCw, Loader2, Download } from 'lucide-react';
import { AdminNav } from './users-client';

interface BrandIntel {
  id: string;
  name: string;
  handle: string | null;
  niche: string | null;
  userEmail: string | null;
  planTier: string;
  selectedCategories: string[];
  weeklyFocus: string | null;
  hasVoiceDoc: boolean;
  voiceDocUpdatedAt: string | null;
  hasBrief: boolean;
  activeSkills: number;
  totalSkills: number;
  correctionsCount: number;
  lastInterviewAt: string | null;
  drafts30d: number;
  posted30d: number;
  unscoredDrafts: number;
}

interface CronRun {
  jobName: string;
  status: string;
  triggeredBy: string;
  result: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: string;
}

interface IntelligenceData {
  brands: BrandIntel[];
  global: { unscoredDrafts: number; unmatchedPostedDrafts: number };
  recentRuns: CronRun[];
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function Pill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${
      ok ? 'bg-[#529E63]/10 text-[#529E63]' : 'bg-muted text-muted-foreground'
    }`}>
      {ok ? <CheckCircle2 size={9} /> : <Clock size={9} />}
      {label}
    </span>
  );
}

function RunBadge({ status }: { status: string }) {
  if (status === 'success') return <CheckCircle2 size={11} className="text-[#529E63]" />;
  if (status === 'failed') return <XCircle size={11} className="text-destructive" />;
  return <Clock size={11} className="text-muted-foreground" />;
}

function runSummary(run: CronRun): string {
  const r = run.result;
  if (!r) return '';
  if (run.jobName === 'daily-sync') {
    const parts: string[] = [];
    if (r.totalTwitter != null) parts.push(`${r.totalTwitter} tweets`);
    if (r.totalLinkedin != null) parts.push(`${r.totalLinkedin} LI posts`);
    if (r.totalMatched != null) parts.push(`${r.totalMatched} drafts matched`);
    return parts.join(' · ');
  }
  if (run.jobName === 'consolidate-skills') {
    return r.message as string ?? `${r.synthesized ?? '?'} brands synthesized`;
  }
  if (run.jobName === 'score-drafts') {
    return `${r.scored ?? 0} scored${r.failed ? ` · ${r.failed} failed` : ''}`;
  }
  return r.message as string ?? JSON.stringify(r).slice(0, 60);
}

function isInterviewOverdue(lastInterviewAt: string | null): boolean {
  return !lastInterviewAt || Date.now() - new Date(lastInterviewAt).getTime() > 14 * 24 * 60 * 60 * 1000;
}

function BrandCard({ brand }: { brand: BrandIntel }) {
  const loopHealth = brand.hasVoiceDoc && brand.activeSkills > 0;
  const needsInterview = isInterviewOverdue(brand.lastInterviewAt);
  const [downloading, setDownloading] = useState(false);

  async function handleExport() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/admin/export?brandId=${brand.id}`);
      if (!res.ok) { alert('Export failed'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1]
        ?? `${brand.name.toLowerCase().replace(/\s+/g, '-')}-export.md`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{brand.name}</span>
            {brand.handle && (
              <span className="text-xs text-muted-foreground">@{brand.handle}</span>
            )}
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground`}>
              {brand.planTier}
            </span>
          </div>
          {brand.userEmail && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{brand.userEmail}</p>
          )}
          {brand.niche && (
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{brand.niche}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          <Pill label="Voice doc" ok={brand.hasVoiceDoc} />
          <Pill label="Brief" ok={brand.hasBrief} />
          <Pill label={`${brand.activeSkills} skills`} ok={brand.activeSkills > 0} />
          {brand.correctionsCount > 0 && (
            <Pill label={`${brand.correctionsCount} rules`} ok={true} />
          )}
          <button
            onClick={handleExport}
            disabled={downloading}
            title="Download full client export as .md"
            className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/60 transition-colors disabled:opacity-40"
          >
            {downloading ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
            Export
          </button>
        </div>
      </div>

      {/* Loop state grid */}
      <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[11px]">
        <div>
          <span className="text-muted-foreground">Voice doc</span>
          <span className="ml-2 text-foreground">
            {brand.hasVoiceDoc ? `updated ${timeAgo(brand.voiceDocUpdatedAt)}` : 'not synthesized yet'}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Last interview</span>
          <span className={`ml-2 ${needsInterview ? 'text-amber-500' : 'text-foreground'}`}>
            {brand.lastInterviewAt ? timeAgo(brand.lastInterviewAt) : 'none'}
            {needsInterview && brand.lastInterviewAt && ', overdue'}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Drafts (30d)</span>
          <span className="ml-2 text-foreground">
            {brand.drafts30d} created · {brand.posted30d} posted
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Unscored</span>
          <span className={`ml-2 ${brand.unscoredDrafts > 0 ? 'text-amber-500' : 'text-foreground'}`}>
            {brand.unscoredDrafts > 0 ? `${brand.unscoredDrafts} pending` : 'all scored'}
          </span>
        </div>
        {brand.selectedCategories.length > 0 && (
          <div className="col-span-2">
            <span className="text-muted-foreground">Pillars</span>
            <span className="ml-2 text-foreground">{brand.selectedCategories.join(', ')}</span>
          </div>
        )}
        {brand.weeklyFocus && (
          <div className="col-span-2">
            <span className="text-muted-foreground">Weekly focus</span>
            <span className="ml-2 text-foreground truncate">{brand.weeklyFocus}</span>
          </div>
        )}
      </div>

      {/* Warnings */}
      {(!loopHealth || needsInterview) && (
        <div className="px-4 py-2 bg-amber-500/5 border-t border-amber-500/20 flex items-start gap-1.5">
          <AlertTriangle size={11} className="text-amber-500 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-600/90">
            {!brand.hasVoiceDoc && 'No voice doc. Run skill synthesis. '}
            {brand.activeSkills === 0 && 'No active skills. Learning loop not running. '}
            {needsInterview && !brand.lastInterviewAt && 'No interview completed yet. '}
            {needsInterview && brand.lastInterviewAt && 'Interview overdue (>14 days). '}
          </p>
        </div>
      )}
    </div>
  );
}

export function IntelligenceClient({ data }: { data: IntelligenceData }) {
  const [refreshing, setRefreshing] = useState(false);
  const [currentData, setCurrentData] = useState(data);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/intelligence');
      if (res.ok) setCurrentData(await res.json());
    } catch { /* ignore */ } finally {
      setRefreshing(false);
    }
  }

  const { brands, global: globals, recentRuns } = currentData;
  const jobNames = ['daily-sync', 'consolidate-skills', 'score-drafts'];
  const lastRunByJob = new Map<string, CronRun>();
  for (const run of recentRuns) {
    if (!lastRunByJob.has(run.jobName)) lastRunByJob.set(run.jobName, run);
  }

  return (
    <>
      <AdminNav active="intelligence" />

      {/* Global health strip */}
      <div className="flex items-center gap-6 mb-6 p-4 bg-card border border-border rounded-lg">
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Brands</p>
          <p className="text-lg font-semibold text-foreground">{brands.length}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Unscored Drafts</p>
          <p className={`text-lg font-semibold ${globals.unscoredDrafts > 10 ? 'text-amber-500' : 'text-foreground'}`}>
            {globals.unscoredDrafts}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Unmatched Posted</p>
          <p className={`text-lg font-semibold ${globals.unmatchedPostedDrafts > 5 ? 'text-amber-500' : 'text-foreground'}`}>
            {globals.unmatchedPostedDrafts}
          </p>
        </div>
        <div className="flex-1" />
        {/* Last run per job */}
        {jobNames.map(job => {
          const run = lastRunByJob.get(job);
          return (
            <div key={job} className="text-right">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                {job === 'daily-sync' ? 'Last Sync' : job === 'consolidate-skills' ? 'Last Synthesis' : 'Last Score'}
              </p>
              <div className="flex items-center gap-1 justify-end">
                {run ? <RunBadge status={run.status} /> : <Clock size={11} className="text-muted-foreground" />}
                <p className="text-xs text-foreground">{run ? timeAgo(run.createdAt) : 'never'}</p>
              </div>
            </div>
          );
        })}
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors ml-2"
        >
          {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {/* Brand cards */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Brand Intelligence ({brands.length})
        </h2>
        {brands.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active brands found.</p>
        ) : (
          <div className="space-y-3">
            {brands.map(b => <BrandCard key={b.id} brand={b} />)}
          </div>
        )}
      </section>

      {/* Recent loop activity */}
      <section className="mt-8">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recent Loop Activity</h2>
        <div className="border border-border rounded-lg bg-card divide-y divide-border">
          {recentRuns.slice(0, 15).map((run, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5">
              <RunBadge status={run.status} />
              <span className="text-xs font-medium text-foreground w-36 shrink-0">{run.jobName}</span>
              <span className="text-[11px] text-muted-foreground flex-1 truncate">{runSummary(run)}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {run.triggeredBy === 'manual' ? 'manual' : 'scheduled'}
              </span>
              {run.durationMs != null && (
                <span className="text-[10px] text-muted-foreground shrink-0">{run.durationMs}ms</span>
              )}
              <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(run.createdAt)}</span>
            </div>
          ))}
          {recentRuns.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-muted-foreground">No loop activity yet. Trigger a job to start.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
