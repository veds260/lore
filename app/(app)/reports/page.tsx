'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from 'recharts';
import { Loader2, RefreshCw, Eye, Heart, Repeat2, MessageCircle, BarChart3 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

interface TopPost {
  id: string;
  content: string;
  postedAt: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  commentCount: number;
  viewCount: number;
  totalInteractions: number;
}

interface AnalyticsData {
  hasSocialData: boolean;
  summary: {
    totalPosts: number;
    latestFollowers: number | null;
    avgEngagement: number | null;
  };
  topPosts: TopPost[];
  followerHistory: Array<{ count: number; date: string }>;
  heatmap: Array<{ day: number; hour: number; avg: number; count: number }>;
  activityByWeek: Array<{ week: string; count: number }>;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmt(n: number | null | undefined): string {
  if (n == null) return '--';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function Shimmer({ className }: { className?: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className ?? ''}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="p-8 max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Shimmer className="h-5 w-24" />
          <Shimmer className="h-3 w-36" />
        </div>
        <Shimmer className="h-7 w-20" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="bg-card border border-border rounded-lg px-4 py-3.5 space-y-2">
            <Shimmer className="h-3 w-20" />
            <Shimmer className="h-6 w-16" />
          </div>
        ))}
      </div>
      <div className="bg-card border border-border rounded-lg px-5 py-4 space-y-3">
        <Shimmer className="h-3 w-28" />
        <Shimmer className="h-40 w-full" />
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3.5 flex flex-col gap-1">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-foreground leading-none">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-4">{children}</p>;
}

function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center py-10">
      <p className="text-sm text-muted-foreground text-center">{children}</p>
    </div>
  );
}

function PostRow({ post }: { post: TopPost }) {
  return (
    <div className="py-3.5 flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-muted-foreground mb-1.5">{timeAgo(post.postedAt)}</p>
        <p className="text-sm text-foreground leading-snug line-clamp-2">{post.content}</p>
        <div className="flex items-center gap-3 mt-2">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Heart size={10} />{fmt(post.likeCount)}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Repeat2 size={10} />{fmt(post.retweetCount)}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <MessageCircle size={10} />{fmt(post.replyCount)}
          </span>
          {post.viewCount > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Eye size={10} />{fmt(post.viewCount)}
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-foreground">{fmt(post.totalInteractions)}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">interactions</p>
      </div>
    </div>
  );
}

const TOOLTIP_STYLE = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 11,
  boxShadow: 'none',
};
const TICK_STYLE = { fontSize: 10, fill: 'var(--muted-foreground)' };

export default function ReportsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'done'>('idle');
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/analytics');
    if (res.ok) setData(await res.json() as AnalyticsData);
    setLoading(false);
  }, []);

  async function triggerSync() {
    if (syncState === 'syncing') return;
    setSyncState('syncing');
    await fetch('/api/twitter/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    await load();
    setSyncedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    setSyncState('done');
  }

  useEffect(() => { Promise.resolve().then(() => load()); }, [load]);

  if (loading) return <LoadingSkeleton />;

  if (!data) {
    return (
      <div className="p-8 lg:p-10 w-full">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">Last 90 days.</p>
        </div>
        <EmptyState
          variant="fullHeight"
          icon={RefreshCw}
          title="Couldn't load analytics"
          description="Something went wrong. Refresh in a moment, or check that your X handle is set in Settings."
          primary={{ label: 'Refresh', onClick: () => window.location.reload() }}
          secondary={{ label: 'Settings', href: '/settings' }}
        />
      </div>
    );
  }

  const heatmapMax = Math.max(...data.heatmap.map(h => h.avg), 1);

  return (
    <div className="p-8 lg:p-10 w-full space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Last 90 days
            {data.summary.totalPosts > 0 && ` · ${data.summary.totalPosts} posts tracked`}
          </p>
        </div>
        <button
          onClick={triggerSync}
          disabled={syncState === 'syncing'}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md px-3 py-1.5 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={11} className={syncState === 'syncing' ? 'animate-spin' : ''} />
          {syncState === 'syncing' ? 'Syncing...' : syncedAt ? syncedAt : 'Sync'}
        </button>
      </div>

      {/* No data */}
      {!data.hasSocialData && (
        <EmptyState
          variant="fullHeight"
          icon={BarChart3}
          title="No posts tracked yet"
          description="Add your X handle in Settings and sync. Lore will pull your post history, score engagement, and show you what your audience actually responds to."
          primary={{
            label: syncState === 'syncing' ? 'Syncing...' : 'Sync now',
            onClick: triggerSync,
            loading: syncState === 'syncing',
          }}
          secondary={{ label: 'Settings', href: '/settings' }}
        />
      )}

      {data.hasSocialData && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label="X followers"
              value={fmt(data.summary.latestFollowers)}
              sub={`${data.summary.totalPosts} posts in 90d`}
            />
            <StatCard
              label="Avg engagement"
              value={data.summary.avgEngagement != null ? String(data.summary.avgEngagement) : '--'}
              sub="likes + reposts + replies"
            />
            <StatCard
              label="Posts tracked"
              value={fmt(data.summary.totalPosts)}
            />
          </div>

          {/* Follower growth */}
          {data.followerHistory.length >= 2 && (
            <div className="bg-card border border-border rounded-lg px-5 py-4">
              <SectionLabel>Follower growth</SectionLabel>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={data.followerHistory} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={TICK_STYLE} interval="preserveStartEnd" />
                  <YAxis axisLine={false} tickLine={false} tick={TICK_STYLE} width={36} tickFormatter={fmt} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val) => [fmt(Number(val)), 'Followers']} />
                  <Line type="monotone" dataKey="count" stroke="currentColor" strokeWidth={1.5} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Posts per week */}
          {data.activityByWeek.length > 0 && (
            <div className="bg-card border border-border rounded-lg px-5 py-4">
              <SectionLabel>Posts per week</SectionLabel>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={data.activityByWeek} barSize={8} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <XAxis dataKey="week" axisLine={false} tickLine={false} tick={TICK_STYLE} />
                  <YAxis axisLine={false} tickLine={false} tick={TICK_STYLE} width={20} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="count" name="Posts" fill="currentColor" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Heatmap + top slots */}
          {data.heatmap.length >= 5 && (
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 bg-card border border-border rounded-lg px-5 py-4">
                <SectionLabel>Best time to post (UTC)</SectionLabel>
                <div className="overflow-x-auto">
                  <div className="min-w-[460px]">
                    <div className="flex gap-[2px] mb-1 ml-8">
                      {Array.from({ length: 24 }, (_, h) => (
                        <div key={h} className="w-4 text-[8px] text-muted-foreground text-center shrink-0">
                          {h % 6 === 0 ? `${h}` : ''}
                        </div>
                      ))}
                    </div>
                    {DAYS.map((day, d) => (
                      <div key={d} className="flex items-center gap-[2px] mb-[2px]">
                        <span className="text-[9px] text-muted-foreground w-7 shrink-0">{day}</span>
                        {Array.from({ length: 24 }, (_, h) => {
                          const cell = data.heatmap.find(x => x.day === d && x.hour === h);
                          const opacity = cell ? Math.max(0.08, cell.avg / heatmapMax) : 0.04;
                          return (
                            <div
                              key={h}
                              title={cell ? `${day} ${h}:00, avg ${cell.avg.toFixed(1)} (${cell.count} posts)` : `${day} ${h}:00`}
                              className="w-4 h-3.5 rounded-[2px] shrink-0 bg-foreground cursor-default"
                              style={{ opacity }}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-lg px-4 py-4">
                <SectionLabel>Top slots</SectionLabel>
                {(() => {
                  const slots = [...data.heatmap].filter(h => h.count >= 2).sort((a, b) => b.avg - a.avg).slice(0, 4);
                  return slots.length === 0
                    ? <ChartEmpty>Not enough data yet.</ChartEmpty>
                    : (
                      <ul className="space-y-3">
                        {slots.map((s, i) => (
                          <li key={i} className="flex items-center justify-between">
                            <span className="text-sm text-foreground">{DAYS[s.day]} {String(s.hour).padStart(2, '0')}:00</span>
                            <span className="text-xs text-muted-foreground tabular-nums">{s.avg.toFixed(1)} avg</span>
                          </li>
                        ))}
                      </ul>
                    );
                })()}
              </div>
            </div>
          )}

          {/* Top posts */}
          <div className="bg-card border border-border rounded-lg px-5 py-4">
            <SectionLabel>Top posts by interactions</SectionLabel>
            {data.topPosts.length === 0
              ? <ChartEmpty>No posts with engagement data yet.</ChartEmpty>
              : (
                <div className="divide-y divide-border">
                  {data.topPosts.slice(0, 10).map(post => (
                    <PostRow key={post.id} post={post} />
                  ))}
                </div>
              )}
          </div>
        </>
      )}
    </div>
  );
}
