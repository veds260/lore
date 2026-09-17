'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Loader2, ArrowRight } from 'lucide-react';
import type { Draft, DraftStatus } from './types';
import type { Profile } from '@/components/ui/platform-mockups';
import { XMark, LinkedinMark } from '@/components/marketing/social';

interface Props {
  drafts: Draft[];
  onCardClick: (id: string) => void;
  onQuickGenerate: (id: string) => Promise<void | boolean>;
  onStatusChange: (id: string, status: DraftStatus) => void;
  onDelete?: (id: string) => void;
  profile?: Profile;
}

const SECTION_CAP = 6;
interface Tone { accent: string; soft: string; ink: string }

const TONES = {
  ready:    { accent: '#22C55E', soft: '#E8F8EE', ink: '#15803D' },
  progress: { accent: '#3B82F6', soft: '#EAF1FF', ink: '#1D4ED8' },
  ideas:    { accent: '#8B5CF6', soft: '#F3EDFF', ink: '#6D28D9' },
} satisfies Record<string, Tone>;

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
  tone: Tone;
  profile?: Profile;
  primaryLabel: string;
  primaryAction: () => void;
  primaryLoading?: boolean;
  onOpen: () => void;
  justAdded?: boolean;
}

function MiniAvatar({ profile }: { profile?: Profile }) {
  const [broken, setBroken] = useState(false);
  const initial = (profile?.displayName || '?').trim()[0]?.toUpperCase() ?? '?';
  if (profile?.avatarUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-8 rounded-full object-cover" />
    );
  }
  return <span className="grid size-8 place-items-center rounded-full bg-[#FF7A45] text-[13px] font-semibold text-white">{initial}</span>;
}

function Row({ draft, tone, profile, primaryLabel, primaryAction, primaryLoading, onOpen, justAdded }: RowProps) {
  const vm = voiceMatch(draft);
  const name = profile?.displayName && profile.displayName !== 'Your Name' ? profile.displayName : 'You';
  const showX = draft.platform !== 'linkedin';
  const showIn = draft.platform !== 'twitter';

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl bg-white p-4 pt-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-14px_rgba(0,0,0,0.25)] ${
        justAdded ? 'ring-2' : 'ring-1 ring-black/[0.06]'
      }`}
      style={justAdded ? { boxShadow: `0 0 0 2px ${tone.accent}` } : undefined}
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: tone.accent }} />

      <button onClick={onOpen} className="flex-1 text-left">
        <div className="flex items-center gap-2.5">
          <MiniAvatar profile={profile} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] font-semibold text-foreground">{name}</p>
            <p className="truncate text-[11.5px] text-muted-foreground">
              {profile?.twitterHandle ? `@${profile.twitterHandle} · ` : ''}{relTime(draft.createdAt)}
            </p>
          </div>
          <span className="flex items-center gap-1">
            {showX && (
              <span className="grid size-6 place-items-center rounded-md bg-[#0F1419] text-white" title="X">
                <XMark className="size-3" />
              </span>
            )}
            {showIn && (
              <span className="grid size-6 place-items-center rounded-md bg-[#0A66C2] text-white" title="LinkedIn">
                <LinkedinMark className="size-3" />
              </span>
            )}
          </span>
        </div>
        <p className="mt-3 whitespace-pre-line text-[14px] leading-[1.5] text-foreground/90 line-clamp-[10]">
          {draft.content.replace(/\n{3,}/g, '\n\n').trim()}
        </p>
      </button>

      <div className="mt-4 flex items-center gap-2">
        {vm != null && (
          <span className="rounded-md px-2 py-1 text-[11px] font-medium tabular-nums" style={{ backgroundColor: tone.soft, color: tone.ink }} title="Voice match: how closely this sounds like you">
            sounds {vm}% like you
          </span>
        )}
        {justAdded && <span className="text-[11px] font-medium" style={{ color: tone.ink }}>saved</span>}
        <button onClick={onOpen} className="ml-auto rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-black/[0.04] hover:text-foreground">
          Edit
        </button>
        <button
          onClick={primaryAction}
          disabled={primaryLoading}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: tone.accent }}
        >
          {primaryLoading ? <Loader2 size={12} className="animate-spin" /> : null}
          {primaryLoading ? 'Working' : primaryLabel}
        </button>
      </div>
    </div>
  );
}

interface SectionProps {
  label: string;
  emoji: string;
  tone: Tone;
  profile?: Profile;
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

function Section({ label, emoji, tone, profile, hint, emptyHint, items, primaryLabelFor, primaryActionFor, generatingId, onOpen, browseHref, totalCount, now }: SectionProps) {
  const overflow = totalCount != null && totalCount > items.length;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-xl text-[16px]" style={{ backgroundColor: tone.soft }} aria-hidden>
            {emoji}
          </span>
          <h2 className="text-[18px] font-semibold tracking-tight text-foreground">{label}</h2>
          {totalCount != null && (
            <span className="rounded-md px-2 py-0.5 text-[12px] font-semibold tabular-nums" style={{ backgroundColor: tone.soft, color: tone.ink }}>
              {totalCount}
            </span>
          )}
        </div>
        {hint && items.length > 0 && (
          <span className="text-[12px] text-muted-foreground">{hint}</span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed px-4 py-4 text-[13px] leading-relaxed" style={{ borderColor: tone.soft, color: tone.ink }}>
          {emptyHint}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map(d => {
            const ageMs = now - new Date(d.createdAt).getTime();
            const justAdded = ageMs >= 0 && ageMs < 5000;
            return (
              <Row
                key={d.id}
                draft={d}
                tone={tone}
                profile={profile}
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

export function SimpleListView({ drafts, onCardClick, onQuickGenerate, onStatusChange, profile }: Props) {
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
    <div className="w-full space-y-8 px-8 pb-10 pt-6">
      <Section
        emoji="🚀"
        tone={TONES.ready}
        profile={profile}
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
        emoji="✍️"
        tone={TONES.progress}
        profile={profile}
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
        emoji="💡"
        tone={TONES.ideas}
        profile={profile}
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
