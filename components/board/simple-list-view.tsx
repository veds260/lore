'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Loader2, ArrowRight } from 'lucide-react';
import type { Draft, DraftStatus } from './types';

interface Props {
  drafts: Draft[];
  onCardClick: (id: string) => void;
  onQuickGenerate: (id: string) => Promise<void | boolean>;
  onStatusChange: (id: string, status: DraftStatus) => void;
  onDelete?: (id: string) => void;
}

const SECTION_CAP = 3;
const DOT_COLOR: Record<DraftStatus, string> = {
  ideas:  '#a78bfa',
  drafts: '#3b82f6',
  review: '#d4a017',
  posted: '#10a37f',
};

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

function voiceMatch(d: Draft): number | null {
  if (!d.scoreBreakdown) return null;
  return Math.round(d.scoreBreakdown.originality * 10);
}

interface RowProps {
  draft: Draft;
  primaryLabel: string;
  primaryAction: () => void;
  primaryLoading?: boolean;
  onOpen: () => void;
  justAdded?: boolean;
}

function Row({ draft, primaryLabel, primaryAction, primaryLoading, onOpen, justAdded }: RowProps) {
  // Collapse any internal blank lines so the line-clamp doesn't render orphan ellipses
  const flat = draft.content.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  const vm = voiceMatch(draft);
  const dot = DOT_COLOR[draft.status];
  const platformLabel = draft.platform === 'both' ? 'X & LinkedIn' : draft.platform === 'linkedin' ? 'LinkedIn' : 'X';

  return (
    <div
      className={`group bg-card border rounded-lg transition-colors flex items-center gap-3 px-4 py-2.5 ${
        justAdded ? 'border-foreground/40' : 'border-border hover:border-muted-foreground/30'
      }`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: dot }}
      />

      <button
        onClick={onOpen}
        className="flex-1 min-w-0 text-left"
      >
        <p className="text-[13.5px] text-foreground leading-[1.45] line-clamp-1">
          {flat}
        </p>
      </button>

      <div className="hidden md:flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
        <span>{platformLabel}</span>
        <span className="opacity-50">·</span>
        <span className="tabular-nums">{relTime(draft.createdAt)}</span>
        {vm != null && (
          <>
            <span className="opacity-50">·</span>
            <span className="tabular-nums" title="Voice match: how closely this sounds like you">
              Voice {vm}%
            </span>
          </>
        )}
        {justAdded && (
          <>
            <span className="opacity-50">·</span>
            <span className="text-foreground">Saved</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onOpen}
          className="text-[11.5px] px-2.5 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          Edit
        </button>
        <button
          onClick={primaryAction}
          disabled={primaryLoading}
          className="text-[11.5px] px-3 py-1.5 bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-40 font-medium flex items-center gap-1.5"
        >
          {primaryLoading ? <Loader2 size={11} className="animate-spin" /> : null}
          {primaryLoading ? 'Working' : primaryLabel}
        </button>
      </div>
    </div>
  );
}

interface SectionProps {
  label: string;
  hint?: string;
  emptyHint: string;
  items: Draft[];
  primaryLabelFor: (d: Draft) => string;
  primaryActionFor: (d: Draft) => () => void;
  generatingId: string | null;
  onOpen: (id: string) => void;
  browseHref?: string;
  totalCount?: number;
  now: number;
}

function Section({ label, hint, emptyHint, items, primaryLabelFor, primaryActionFor, generatingId, onOpen, browseHref, totalCount, now }: SectionProps) {
  const overflow = totalCount != null && totalCount > items.length;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-2.5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold text-foreground tracking-tight">
            {label}
          </h2>
          {totalCount != null && (
            <span className="text-[12px] tabular-nums text-muted-foreground">{totalCount}</span>
          )}
        </div>
        {hint && items.length > 0 && (
          <span className="text-[11px] text-muted-foreground">{hint}</span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
          {emptyHint}
        </p>
      ) : (
        <div className="space-y-1.5">
          {items.map(d => {
            const ageMs = now - new Date(d.createdAt).getTime();
            const justAdded = ageMs >= 0 && ageMs < 5000;
            return (
              <Row
                key={d.id}
                draft={d}
                primaryLabel={primaryLabelFor(d)}
                primaryAction={primaryActionFor(d)}
                primaryLoading={generatingId === d.id}
                onOpen={() => onOpen(d.id)}
                justAdded={justAdded}
              />
            );
          })}
        </div>
      )}
      {overflow && browseHref && (
        <Link
          href={browseHref}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Browse all {totalCount}
          <ArrowRight size={10} />
        </Link>
      )}
    </section>
  );
}

export function SimpleListView({ drafts, onCardClick, onQuickGenerate, onStatusChange }: Props) {
  const [genId, setGenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ready    = drafts.filter(d => d.status === 'review');
  const inProg   = drafts.filter(d => d.status === 'drafts');
  const ideas    = drafts.filter(d => d.status === 'ideas');
  const posted   = drafts.filter(d => d.status === 'posted');

  // Sort newest-first within each bucket
  const byNewest = (a: Draft, b: Draft) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

  ready.sort(byNewest);
  inProg.sort(byNewest);
  ideas.sort(byNewest);
  posted.sort(byNewest);

  return (
    <div className="px-8 py-2 space-y-4 w-full">
      <Section
        label="Ready to post"
        hint={ready.length === 0 ? undefined : 'Polished and waiting'}
        emptyHint="Drafts you mark ready will land here, queued for the day you ship them."
        items={ready.slice(0, SECTION_CAP)}
        totalCount={ready.length}
        primaryLabelFor={() => 'Mark posted'}
        primaryActionFor={d => () => onStatusChange(d.id, 'posted')}
        generatingId={genId}
        onOpen={onCardClick}
        now={now}
      />

      <Section
        label="In progress"
        hint={inProg.length === 0 ? undefined : 'Drafts to polish'}
        emptyHint="Generated drafts you're still tweaking show up here."
        items={inProg.slice(0, SECTION_CAP)}
        totalCount={inProg.length}
        primaryLabelFor={() => 'Mark ready'}
        primaryActionFor={d => () => onStatusChange(d.id, 'review')}
        generatingId={genId}
        onOpen={onCardClick}
        now={now}
      />

      <Section
        label="Just captured"
        hint={ideas.length === 0 ? undefined : 'Fresh ideas. Turn into posts'}
        emptyHint="Voice memos on Telegram, interview answers, and pulse-card saves all land here as ideas."
        items={ideas.slice(0, SECTION_CAP)}
        totalCount={ideas.length}
        browseHref="/ideas"
        primaryLabelFor={() => 'Generate post'}
        primaryActionFor={d => async () => {
          setGenId(d.id);
          await onQuickGenerate(d.id);
          setGenId(null);
        }}
        generatingId={genId}
        onOpen={onCardClick}
        now={now}
      />

      {/* Browse links, always shown so users know where the deeper views live */}
      <div className="border-t border-border pt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link
          href="/ideas"
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          {ideas.length > 0 ? `All ${ideas.length} ideas` : 'Browse your idea pool'}
          <ArrowRight size={10} />
        </Link>
        <Link
          href="/reports"
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          {posted.length > 0 ? `${posted.length} posted · see performance` : 'See post history'}
          <ArrowRight size={10} />
        </Link>
        <Link
          href="/learning"
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          What Lore has learned
          <ArrowRight size={10} />
        </Link>
      </div>
    </div>
  );
}
