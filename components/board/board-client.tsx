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

interface BoardClientProps {
  initialDrafts: Draft[];
  firstVisit?: boolean;
}

export function BoardClient({ initialDrafts }: BoardClientProps) {
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
    <div className="flex flex-col h-full">
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
      <div className="flex-1 overflow-y-auto">
        <SimpleListView
          drafts={drafts}
          onCardClick={id => setOpenId(prev => (prev === id ? null : id))}
          onQuickGenerate={handleQuickGenerate}
          onStatusChange={handleStatusChange}
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

// WhatsNext: today-focused header.
//  - empty state: minimal copy + three plain options
//  - active state: "Today" label + status sentence + New post action

interface WhatsNextProps {
  drafts: Draft[];
  onCardClick: (id: string) => void;
  onComposerOpen: () => void;
  onQuickGenerate: (id: string) => Promise<void | boolean>;
}

function WhatsNext({ drafts, onComposerOpen }: WhatsNextProps) {
  // Empty state
  if (drafts.length === 0) {
    return (
      <div className="px-8 pt-2 pb-8 shrink-0">
        <h1 className="text-xl font-semibold text-foreground mb-1.5 tracking-tight">
          Let&apos;s get today&apos;s post ready.
        </h1>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          Three ways in. Whichever feels fastest.
        </p>

        <div className="space-y-2">
          <button
            onClick={onComposerOpen}
            data-tour="new-post"
            className="w-full text-left bg-card border border-border rounded-lg px-4 py-3.5 hover:border-foreground/40 transition-colors"
          >
            <p className="text-[13.5px] font-medium text-foreground">Write something new</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Type a topic. Lore writes the X and LinkedIn versions together.
            </p>
          </button>

          <div className="bg-card border border-border rounded-lg px-4 py-3.5">
            <p className="text-[13.5px] font-medium text-foreground">React to today&apos;s pulse</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Scroll down to the pulse strip. Tap any generate button on a card you find sharp.
            </p>
          </div>

          <div className="bg-card border border-border rounded-lg px-4 py-3.5">
            <p className="text-[13.5px] font-medium text-foreground">Send Lore a voice memo</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Connect Telegram in settings. Speak from anywhere, get drafts in your board.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Active state
  return (
    <div className="px-8 pt-1 pb-1 shrink-0 flex items-center justify-end gap-4">
      <button
        data-tour="new-post"
        onClick={onComposerOpen}
        className="text-[12.5px] px-3 py-1.5 bg-foreground text-background rounded-md hover:opacity-90 transition-opacity font-medium"
      >
        New post
      </button>
    </div>
  );
}
