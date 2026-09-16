'use client';

import Link from 'next/link';
import { TrendingUp, TrendingDown, Sparkles, BookOpen, FileText, Brain, ArrowRight, Heart, MessageCircle, Repeat2, Eye } from 'lucide-react';
import type { LearningInsights } from '@/lib/learning-insights';
import { EmptyState } from '@/components/ui/empty-state';

export type InsightsData = LearningInsights;

function StatCard({ label, value, sub, trend }: { label: string; value: string | number; sub?: string; trend?: number | null }) {
  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <p className="text-xl font-semibold text-foreground tabular-nums">{value}</p>
        {trend != null && (
          <span className={`flex items-center gap-0.5 text-[11px] font-medium ${
            trend > 0 ? 'text-emerald-600 dark:text-emerald-400' : trend < 0 ? 'text-destructive' : 'text-muted-foreground'
          }`}>
            {trend > 0 ? <TrendingUp size={10} /> : trend < 0 ? <TrendingDown size={10} /> : null}
            {trend > 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function fmtNum(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return n.toString();
}

const KIND_LABEL: Record<string, string> = {
  voice_rule:         'Voice',
  avoidance_rule:     'Avoid',
  format_rule:        'Format',
  structure_template: 'Structure',
  hook_formula:       'Hook',
};

export function LearningClient({ data }: { data: InsightsData }) {
  const { stats, topPosts, learnedRules, hooks, voiceProfile } = data;
  const hasAnything = stats.postsPublished > 0 || stats.draftsCreated > 0 || learnedRules.length > 0;

  if (!hasAnything) {
    return (
      <div className="p-8 lg:p-10 w-full">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Learning</h1>
          <p className="text-sm text-muted-foreground mt-1">Last 30 days</p>
        </div>
        <EmptyState
          variant="fullHeight"
          icon={Brain}
          title="Nothing to show yet"
          description="Once you publish a few posts and revise drafts, Lore starts learning what works for you: your top hooks, your voice rules, your patterns. Come back after your first week."
          primary={{ label: 'Open board', href: '/board' }}
        />
      </div>
    );
  }

  return (
    <div className="p-8 lg:p-10 w-full space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Learning</h1>
        <p className="text-sm text-muted-foreground mt-1">Last 30 days</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Posts published"
          value={stats.postsPublished}
          sub={stats.draftsCreated > 0 ? `${stats.draftsCreated} drafts written` : undefined}
        />
        <StatCard
          label="Avg impressions"
          value={fmtNum(stats.avgImpressions)}
          trend={stats.avgImpressionsDelta}
          sub={stats.avgImpressionsDelta != null ? 'vs prior 30d' : undefined}
        />
        <StatCard
          label="Rules learned"
          value={stats.rulesLearnedRecently}
          sub={stats.totalRules > 0 ? `${stats.totalRules} total in your library` : undefined}
        />
        <StatCard
          label="Hooks in library"
          value={stats.hooksInLibrary}
          sub={hooks[0]?.timesApplied ? `top: used ${hooks[0].timesApplied}×` : undefined}
        />
      </div>

      {/* What's working: top posts */}
      {topPosts.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={14} className="text-foreground" strokeWidth={1.8} />
            <h2 className="text-sm font-semibold">What&apos;s working</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Your top {topPosts.length} {topPosts.length === 1 ? 'post' : 'posts'} by engagement this month.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {topPosts.map(p => (
              <div key={p.id} className="bg-card border border-border rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {p.platform === 'linkedin' ? 'LinkedIn' : 'X'}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">·</span>
                  <span className="text-[10px] text-muted-foreground">{relativeDate(p.postedAt)}</span>
                </div>
                <p className="text-sm text-foreground leading-snug line-clamp-2">{p.hook}</p>
                <div className="flex items-center gap-4 mt-2.5 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Heart size={10} /> {fmtNum(p.likes)}</span>
                  <span className="flex items-center gap-1"><MessageCircle size={10} /> {fmtNum(p.replies)}</span>
                  <span className="flex items-center gap-1"><Repeat2 size={10} /> {fmtNum(p.reposts)}</span>
                  {p.views > 0 && <span className="flex items-center gap-1"><Eye size={10} /> {fmtNum(p.views)}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Rules learned */}
      {learnedRules.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Brain size={14} className="text-foreground" strokeWidth={1.8} />
            <h2 className="text-sm font-semibold">Rules I learned from your edits</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Patterns auto-detected from how you revise drafts. Used on every future generation.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {learnedRules.map(r => (
              <div key={r.id} className="bg-card border border-border rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {KIND_LABEL[r.kind] ?? r.kind}
                  </span>
                  {r.timesApplied > 0 && (
                    <span className="text-[10px] text-muted-foreground ml-auto">used {r.timesApplied}×</span>
                  )}
                </div>
                <p className="text-sm font-medium text-foreground leading-snug">{r.name}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">{r.body}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-2">Learned {relativeDate(r.learnedAt)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Hook library */}
      {hooks.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={14} className="text-foreground" strokeWidth={1.8} />
            <h2 className="text-sm font-semibold">Your hook library</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Hook patterns Lore has saved from your highest-performing posts.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {hooks.map(h => (
              <div key={h.id} className="bg-card border border-border rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-medium text-foreground flex-1">{h.name}</p>
                  {h.timesApplied > 0 && (
                    <span className="text-[10px] text-muted-foreground tabular-nums">used {h.timesApplied}×</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{h.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* More: links to detailed analytics & rules library */}
      <section className="border-t border-border pt-6 space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Dig deeper</p>
        <Link
          href="/reports"
          className="flex items-center justify-between gap-3 px-4 py-3 bg-card border border-border rounded-lg hover:border-muted-foreground/40 transition-colors"
        >
          <div>
            <p className="text-sm font-medium text-foreground">Detailed performance charts</p>
            <p className="text-xs text-muted-foreground mt-0.5">Follower history, engagement heatmap, posting cadence.</p>
          </div>
          <ArrowRight size={13} className="text-muted-foreground shrink-0" />
        </Link>
        <Link
          href="/skills"
          className="flex items-center justify-between gap-3 px-4 py-3 bg-card border border-border rounded-lg hover:border-muted-foreground/40 transition-colors"
        >
          <div>
            <p className="text-sm font-medium text-foreground">Full rules library</p>
            <p className="text-xs text-muted-foreground mt-0.5">Every voice rule Lore has learned. Edit, dismiss, or add manually.</p>
          </div>
          <ArrowRight size={13} className="text-muted-foreground shrink-0" />
        </Link>
      </section>

      {/* Voice profile footer */}
      <section className="border-t border-border pt-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Voice profile</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {voiceProfile.lastUpdated
                ? `Last refreshed ${relativeDate(voiceProfile.lastUpdated)}`
                : 'Not generated yet. Runs weekly once you have enough activity'}
            </p>
          </div>
          <Link
            href="/profile"
            className="flex items-center gap-1 text-xs text-foreground hover:underline underline-offset-2 font-medium"
          >
            View profile <ArrowRight size={11} />
          </Link>
        </div>
        {voiceProfile.pillars.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {voiceProfile.pillars.map((p, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{p}</span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
