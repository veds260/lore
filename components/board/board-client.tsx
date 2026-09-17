'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { type Profile, FALLBACK_PROFILE } from '@/components/ui/platform-mockups';
import type { Draft, DraftSourceInput, DraftStatus, RecommendedImage } from './types';
import { DraftDrawer } from './draft-drawer';
import { DraftComposer, type NewDraft } from './draft-composer';
import { TrendsStrip } from './trends-strip';
import { SimpleListView } from './simple-list-view';
import { LimitReachedModal } from '@/components/ui/limit-reached-modal';
import { X, LayoutTemplate } from 'lucide-react';

export interface BoardStats {
  postsRead: number;
  rulesLearned: number;
}

interface BoardClientProps {
  initialDrafts: Draft[];
  firstVisit?: boolean;
  stats?: BoardStats;
}

export function BoardClient({ initialDrafts, stats }: BoardClientProps) {
  const [drafts, setDrafts] = useState<Draft[]>(initialDrafts);
  const [openId, setOpenId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [profile, setProfile] = useState<Profile>(FALLBACK_PROFILE);
  const [limitModal, setLimitModal] = useState<{ limit: number; retryFn: () => Promise<void> } | null>(null);
  const [useTemplate, setUseTemplate] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('lore-use-template') === 'true';
  });

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setProfile(data); })
      .catch(() => {});
  }, []);

  // Persist template preference
  useEffect(() => {
    localStorage.setItem('lore-use-template', String(useTemplate));
  }, [useTemplate]);

  const openDraft = drafts.find(d => d.id === openId) ?? null;

  const handleStatusChange = useCallback((id: string, status: DraftStatus) => {
    setDrafts(prev => prev.map(d => (d.id === id ? { ...d, status } : d)));
    setOpenId(id); // keep drawer open, showing new status

    // Persist if not a demo card
    const draft = drafts.find(d => d.id === id);
    if (draft && !draft.isDemo) {
      fetch(`/api/drafts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }).catch(() => {});
    }
  }, [drafts]);

  // Debounce ref for content changes
  const contentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleContentChange = useCallback((id: string, content: string, linkedinContent?: string) => {
    setDrafts(prev => prev.map(d => (d.id === id ? { ...d, content, linkedinContent } : d)));

    // Persist debounced, skip demo cards
    const draft = drafts.find(d => d.id === id);
    if (draft && !draft.isDemo) {
      if (contentDebounceRef.current) clearTimeout(contentDebounceRef.current);
      contentDebounceRef.current = setTimeout(() => {
        fetch(`/api/drafts/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, linkedinContent }),
        }).catch(() => {});
      }, 1000);
    }
  }, [drafts]);

  const applyGenResult = useCallback(async (id: string, content: string, linkedinContent: string, imageUrl?: string, sourceInputs?: DraftSourceInput[], recommendedImage?: RecommendedImage) => {
    setDrafts(prev => prev.map(d => d.id === id ? { ...d, content, linkedinContent, imageUrl: imageUrl ?? d.imageUrl, sourceInputs, recommendedImage: recommendedImage ?? d.recommendedImage, status: 'drafts' } : d));
    await fetch(`/api/drafts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, linkedinContent, imageUrl, sourceInputs, recommendedImage, status: 'drafts' }),
    });
  }, []);

  const handleQuickGenerate = useCallback(async (id: string, forceCredits = false): Promise<boolean> => {
    const idea = drafts.find(d => d.id === id);
    if (!idea || idea.isDemo) return false;

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: idea.content, length: 'auto', useTemplate, chat: forceCredits || undefined }),
      });
      const data = await res.json() as { twitter?: string; linkedin?: string; imageUrl?: string; recommendedImage?: RecommendedImage; sourceInputs?: DraftSourceInput[]; type?: string; limit?: number };
      if (data.type === 'daily_limit_reached') {
        setLimitModal({ limit: data.limit ?? 3, retryFn: async () => {
          setLimitModal(null);
          try {
            const retryRes = await fetch('/api/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ topic: idea.content, length: 'auto', useTemplate, chat: true }),
            });
            const retryData = await retryRes.json() as { twitter?: string; linkedin?: string; imageUrl?: string; recommendedImage?: RecommendedImage; sourceInputs?: DraftSourceInput[] };
            if (retryData.twitter) {
              await applyGenResult(id, retryData.twitter, retryData.linkedin ?? '', retryData.imageUrl, retryData.sourceInputs, retryData.recommendedImage);
            }
          } catch {}
        }});
        return true; // hit limit, caller should stop
      }
      if (!data.twitter) return false;
      await applyGenResult(id, data.twitter, data.linkedin ?? '', data.imageUrl, data.sourceInputs, data.recommendedImage);
    } catch {}
    return false;
  }, [drafts, useTemplate, applyGenResult]);

  const handleNewDraft = useCallback(async (newDraft: NewDraft) => {
    const tempId = `temp-${Math.random().toString(36).slice(2)}`;
    const draft: Draft = {
      id: tempId,
      content: newDraft.content,
      linkedinContent: newDraft.linkedinContent,
      imageUrl: newDraft.imageUrl,
      recommendedImage: newDraft.recommendedImage,
      sourceInputs: newDraft.sourceInputs,
      platform: newDraft.platform,
      status: newDraft.status,
      createdAt: new Date().toISOString(),
    };
    setDrafts(prev => [draft, ...prev]);

    // Persist to DB and replace tempId with real DB id
    try {
      const res = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newDraft.content,
          linkedinContent: newDraft.linkedinContent,
          imageUrl: newDraft.imageUrl,
          recommendedImage: newDraft.recommendedImage,
          sourceInputs: newDraft.sourceInputs,
          platform: newDraft.platform,
          status: newDraft.status,
          templateId: newDraft.templateId,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { id: string };
        setDrafts(prev => prev.map(d => d.id === tempId ? { ...d, id: data.id } : d));
      }
    } catch {
      // Leave with tempId if request fails, UI still functional
    }
  }, []);

  const handleImageChange = useCallback((id: string, imageUrl: string | null) => {
    setDrafts(prev => prev.map(d => d.id === id ? { ...d, imageUrl: imageUrl ?? undefined } : d));
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      {limitModal && (
        <LimitReachedModal
          limit={limitModal.limit}
          onUseCredits={limitModal.retryFn}
          onClose={() => setLimitModal(null)}
        />
      )}
      {/* What's next: status sentence + suggested action */}
      <WhatsNext
        drafts={drafts.filter(d => !d.isDemo)}
        profile={profile}
        stats={stats ?? { postsRead: 0, rulesLearned: 0 }}
        onCardClick={id => setOpenId(prev => (prev === id ? null : id))}
        onComposerOpen={() => setComposerOpen(true)}
        onQuickGenerate={handleQuickGenerate}
      />

      {/* Daily trends strip */}
      <TrendsStrip onSaveDraft={handleNewDraft} profile={profile} />

      {/* Format mode indicator, quiet inline note */}
      {useTemplate && (
        <div className="mx-8 mb-0 mt-0 flex items-center gap-2 px-3 py-1.5 border-t border-b border-border text-[11px] text-muted-foreground">
          <LayoutTemplate size={11} />
          <span>Format mode is on. Posts will follow a proven structure from your library.</span>
          <button
            onClick={() => setUseTemplate(false)}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            title="Turn off"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {/* Main view */}
      <div>
        <SimpleListView
          drafts={drafts}
          onCardClick={id => setOpenId(prev => (prev === id ? null : id))}
          onQuickGenerate={handleQuickGenerate}
          onStatusChange={handleStatusChange}
          profile={profile}
        />
      </div>

      <DraftDrawer
        draft={openDraft}
        onClose={() => setOpenId(null)}
        onStatusChange={handleStatusChange}
        onContentChange={handleContentChange}
        onImageChange={handleImageChange}
        profile={profile}
        useTemplate={useTemplate}
        onUseTemplateChange={setUseTemplate}
      />

      <DraftComposer
        isOpen={composerOpen}
        onClose={() => setComposerOpen(false)}
        onSave={handleNewDraft}
      />
    </div>
  );
}

// WhatsNext: the board's header. A greeting with the user's own face, a few real
// numbers about their account, and one obvious way to start a post.

interface WhatsNextProps {
  drafts: Draft[];
  profile: Profile;
  stats: BoardStats;
  onCardClick: (id: string) => void;
  onComposerOpen: () => void;
  onQuickGenerate: (id: string) => Promise<void | boolean>;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'up late';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function Avatar({ profile, size }: { profile: Profile; size: number }) {
  const [broken, setBroken] = useState(false);
  const initial = (profile.displayName || '?').trim()[0]?.toUpperCase() ?? '?';
  if (profile.avatarUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={profile.avatarUrl.replace('_normal.', '_400x400.')}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="rounded-full object-cover ring-4 ring-white shadow-[0_6px_20px_-6px_rgba(0,0,0,0.25)]"
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size }}
      className="grid place-items-center rounded-full bg-[#FF7A45] text-white text-2xl font-semibold ring-4 ring-white"
    >
      {initial}
    </span>
  );
}

const STAT_TILES = [
  { key: 'read', label: 'posts it read', bg: '#FFF1E6', fg: '#C2410C', dot: '#FF7A45' },
  { key: 'drafts', label: 'drafts cooking', bg: '#EAF1FF', fg: '#1D4ED8', dot: '#3B82F6' },
  { key: 'ready', label: 'ready to post', bg: '#E8F8EE', fg: '#15803D', dot: '#22C55E' },
  { key: 'rules', label: 'rules it learned', bg: '#F3EDFF', fg: '#6D28D9', dot: '#8B5CF6' },
] as const;

function WhatsNext({ drafts, profile, stats, onComposerOpen }: WhatsNextProps) {
  const first = profile.displayName && profile.displayName !== 'Your Name' ? profile.displayName.split(' ')[0] : '';
  const values: Record<(typeof STAT_TILES)[number]['key'], number> = {
    read: stats.postsRead,
    drafts: drafts.filter(d => d.status === 'drafts' || d.status === 'ideas').length,
    ready: drafts.filter(d => d.status === 'review').length,
    rules: stats.rulesLearned,
  };
  const empty = drafts.length === 0;

  return (
    <div className="px-8 pt-7 pb-6 shrink-0">
      <div className="flex flex-wrap items-center gap-5">
        <Avatar profile={profile} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[30px] leading-tight font-semibold tracking-tight text-foreground">
            {greeting()}{first ? `, ${first.toLowerCase()}` : ''} <span aria-hidden>👋</span>
          </h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {empty
              ? 'type a topic and lore writes it the way you actually talk'
              : values.ready > 0
                ? `${values.ready} post${values.ready === 1 ? ' is' : 's are'} ready to go out today`
                : 'your drafts are waiting, pick one and make it yours'}
          </p>
        </div>
        <button
          data-tour="new-post"
          onClick={onComposerOpen}
          className="inline-flex items-center gap-2 rounded-xl bg-[#FF5A1F] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(255,90,31,0.8)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
        >
          <span className="text-lg leading-none">+</span> New post
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        {STAT_TILES.map(t => (
          <div key={t.key} className="rounded-2xl px-4 py-3.5" style={{ backgroundColor: t.bg }}>
            <p className="text-[28px] font-semibold leading-none tabular-nums" style={{ color: t.fg }}>
              {values[t.key].toLocaleString()}
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: t.fg }}>
              <span className="size-1.5 rounded-full" style={{ backgroundColor: t.dot }} />
              {t.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
