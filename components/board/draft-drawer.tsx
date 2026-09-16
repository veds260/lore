'use client';

import { useEffect, useRef, useState } from 'react';
import { X, ChevronRight, Loader2, Sparkles, Check, Brain, ImageIcon, Trash2, BookmarkPlus, LayoutTemplate, CalendarClock } from 'lucide-react';
import type { Draft, DraftSourceInput, DraftSourceRecord, DraftStatus, RecommendedImage } from './types';
import { COLUMNS, NEXT_STATUS } from './types';
import { TwitterMockup, LinkedInMockup, type Profile, FALLBACK_PROFILE } from '@/components/ui/platform-mockups';
import { LimitReachedModal } from '@/components/ui/limit-reached-modal';
import { DrawerCoachmarks } from '@/components/tour/drawer-coachmarks';


interface DraftDrawerProps {
  draft: Draft | null;
  onClose: () => void;
  onStatusChange: (id: string, status: DraftStatus) => void;
  onContentChange: (id: string, content: string, linkedinContent?: string) => void;
  onImageChange?: (id: string, imageUrl: string | null) => void;
  profile?: Profile;
  useTemplate?: boolean;
  onUseTemplateChange?: (v: boolean) => void;
}

type DrawerMode = 'preview' | 'edit' | 'revise';

type LearningSuggestion = {
  title: string;
  observation: string;
  reason: string;
  confidence: number;
  tags: string[];
  platform: string;
};


export function DraftDrawer({ draft, onClose, onStatusChange, onContentChange, onImageChange, profile = FALLBACK_PROFILE, useTemplate = false, onUseTemplateChange }: DraftDrawerProps) {
  const [activePlatform, setActivePlatform] = useState<'twitter' | 'linkedin'>('twitter');
  const [mode, setMode] = useState<DrawerMode>('preview');

  const [twitterContent, setTwitterContent] = useState('');
  const [linkedinContent, setLinkedinContent] = useState('');

  const [reviseInstruction, setReviseInstruction] = useState('');
  const [reviseBase, setReviseBase] = useState<string | null>(null); // null = use activeContent
  const [revisionOriginal, setRevisionOriginal] = useState<string | null>(null); // content before ANY revisions
  const [revisionInstructions, setRevisionInstructions] = useState<string[]>([]); // instructions from "Revise further" steps
  const [revisedContent, setRevisedContent] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [learnedSkill, setLearnedSkill] = useState<{ name: string; body?: string } | null>(null);
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [scheduledOk, setScheduledOk] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [learningSuggestion, setLearningSuggestion] = useState<LearningSuggestion | null>(null);
  const [savingLearningSuggestion, setSavingLearningSuggestion] = useState(false);
  const [learningSuggestionSaved, setLearningSuggestionSaved] = useState(false);
  const instructionRef = useRef<HTMLTextAreaElement>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [recommendedImage, setRecommendedImage] = useState<RecommendedImage | null>(null);
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageError, setImageError] = useState('');
  const [imageSize, setImageSize] = useState<'square' | 'landscape' | 'banner'>('square');

  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savedTemplate, setSavedTemplate] = useState<{ name: string } | null>(null);

  const [generating, setGenerating] = useState(false);
  const [sources, setSources] = useState<DraftSourceRecord[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [limitModal, setLimitModal] = useState<{ limit: number; retryFn: () => Promise<void> } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const isOpen = draft !== null;
  const hasBoth = !!(draft?.linkedinContent);
  const activeContent = activePlatform === 'twitter' ? twitterContent : linkedinContent;
  const setActiveContent = activePlatform === 'twitter' ? setTwitterContent : setLinkedinContent;

  useEffect(() => {
    if (draft) {
      // LinkedIn-only drafts (e.g. from a mainstream news card) store the body in
      // `draft.content` with no separate linkedinContent. Map content → the active
      // platform's field so the editor isn't blank.
      if (draft.platform === 'linkedin') {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTwitterContent('');
        setLinkedinContent(draft.linkedinContent || draft.content || '');
      } else {
        setTwitterContent(draft.content);
        setLinkedinContent(draft.linkedinContent ?? '');
      }
      setMode('preview');
      setRevisedContent(null);
      setReviseBase(null);
      setRevisionOriginal(null);
      setRevisionInstructions([]);
      setReviseInstruction('');
      setLearnedSkill(null);
      setLearningSuggestion(null);
      setSavingLearningSuggestion(false);
      setLearningSuggestionSaved(false);
      setImageUrl(draft.imageUrl ?? null);
      setRecommendedImage(draft.recommendedImage ?? null);
      setImageError('');
      setImageSize('square');
      setActivePlatform(draft.platform === 'linkedin' ? 'linkedin' : 'twitter');
      setSavedTemplate(null);
      setSources([]);
      setGenerating(false);
      setScheduleAt('');
      setScheduling(false);
      setScheduledOk(false);
      setScheduleError(null);
    }
  }, [draft?.id]);

  useEffect(() => {
    if (!draft || draft.id.startsWith('demo-') || draft.id.startsWith('temp-')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSources([]);
      return;
    }
    let cancelled = false;
    setSourcesLoading(true);
    fetch(`/api/drafts/${draft.id}/sources`)
      .then(r => r.ok ? r.json() : { sources: [] })
      .then((data: { sources?: DraftSourceRecord[] }) => {
        if (!cancelled) setSources(data.sources ?? []);
      })
      .catch(() => { if (!cancelled) setSources([]); })
      .finally(() => { if (!cancelled) setSourcesLoading(false); });
    return () => { cancelled = true; };
  }, [draft?.id]);

  useEffect(() => {
    if (mode === 'edit' && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(activeContent.length, activeContent.length);
    }
  }, [mode]);

  function handleSaveEdit() {
    if (!draft) return;
    // LinkedIn-only draft: the LinkedIn body lives in `content`, not in
    // `linkedinContent`. Save it back to `content` so the In Progress card
    // list keeps showing it.
    if (draft.platform === 'linkedin') {
      onContentChange(draft.id, linkedinContent, undefined);
    } else {
      onContentChange(draft.id, twitterContent, linkedinContent || undefined);
    }
    setMode('preview');
  }

  function handleCancelEdit() {
    if (!draft) return;
    if (draft.platform === 'linkedin') {
      setTwitterContent('');
      setLinkedinContent(draft.linkedinContent || draft.content || '');
    } else {
      setTwitterContent(draft.content);
      setLinkedinContent(draft.linkedinContent ?? '');
    }
    setMode('preview');
  }

  async function handleGenerateImage() {
    if (!draft || imageGenerating) return;
    setImageGenerating(true);
    setImageError('');
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: twitterContent || draft.content, size: imageSize }),
      });
      const data = await res.json() as { imageUrl?: string; error?: string; size?: string };
      if (!res.ok) throw new Error(data.error ?? 'Image generation failed');
      const returnedSize = (data.size as typeof imageSize) ?? imageSize;
      const newImageUrl = data.imageUrl ?? null;
      setImageUrl(newImageUrl);
      setRecommendedImage(null);
      setImageSize(returnedSize);
      onImageChange?.(draft.id, newImageUrl);
      // Persist to draft
      await fetch(`/api/drafts/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: data.imageUrl, imageSize: returnedSize, recommendedImage: null }),
      });
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Image generation failed');
    } finally {
      setImageGenerating(false);
    }
  }

  async function handleRemoveImage() {
    if (!draft) return;
    setImageUrl(null);
    setRecommendedImage(null);
    setImageError('');
    onImageChange?.(draft.id, null);
    await fetch(`/api/drafts/${draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: null, recommendedImage: null }),
    });
  }

  async function handleRevise() {
    if (!reviseInstruction.trim() || revising) return;

    // Capture the original before any AI changes (only on first call)
    if (!revisionOriginal) {
      setRevisionOriginal(reviseBase ?? activeContent);
    }

    setRevising(true);
    setRevisedContent(null);

    try {
      const res = await fetch('/api/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: reviseBase ?? activeContent,
          originalContent: revisionOriginal ?? reviseBase ?? activeContent,
          instruction: reviseInstruction,
          platform: activePlatform,
        }),
      });
      const data = await res.json() as { revised?: string; learningSuggestion?: LearningSuggestion | null };
      if (res.ok && data.revised) {
        setRevisedContent(data.revised);
        setLearningSuggestion(data.learningSuggestion ?? null);
        setLearningSuggestionSaved(false);
      }
    } finally {
      setRevising(false);
    }
  }

  function handleReviseFromRevised() {
    if (!revisedContent) return;
    setRevisionInstructions(prev => [...prev, reviseInstruction]);
    setReviseBase(revisedContent);
    setRevisedContent(null);
    setLearningSuggestion(null);
    setLearningSuggestionSaved(false);
    setReviseInstruction('');
    setTimeout(() => instructionRef.current?.focus(), 50);
  }

  async function handleAcceptRevision() {
    if (!revisedContent || !draft) return;

    // The original is what was there before any revisions in this session
    const original = revisionOriginal ?? activeContent;
    // All instructions in order, including the current final one
    const allInstructions = [...revisionInstructions, reviseInstruction].filter(Boolean);
    const finalRevised = revisedContent;

    setActiveContent(finalRevised);
    if (activePlatform === 'twitter') {
      onContentChange(draft.id, finalRevised, linkedinContent || undefined);
    } else if (draft.platform === 'linkedin') {
      // LinkedIn-only draft: body lives in `content`
      onContentChange(draft.id, finalRevised, undefined);
    } else {
      onContentChange(draft.id, twitterContent, finalRevised);
    }

    setRevisedContent(null);
    setLearningSuggestion(null);
    setLearningSuggestionSaved(false);
    setReviseBase(null);
    setRevisionOriginal(null);
    setRevisionInstructions([]);
    setReviseInstruction('');
    setMode('preview');
    setLearnedSkill(null);
    setTimeout(() => bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 50);

    fetch('/api/skills/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        original,
        revised: finalRevised,
        instructions: allInstructions,
        platform: activePlatform,
      }),
    })
      .then(r => r.json())
      .then(data => { if (data.skill) setLearnedSkill(data.skill); })
      .catch(() => {});
  }

  async function handleSchedule() {
    if (!draft || !scheduleAt || scheduling) return;
    setScheduling(true);
    setScheduleError(null);
    try {
      const res = await fetch('/api/scheduled-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: twitterContent || draft.content,
          scheduledFor: new Date(scheduleAt).toISOString(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setScheduleError(
          res.status === 409
            ? 'Connect X in settings first, then schedule from here.'
            : (json.error ?? 'Could not schedule.'),
        );
        return;
      }
      setScheduledOk(true);
    } catch {
      setScheduleError('Could not schedule.');
    } finally {
      setScheduling(false);
    }
  }

  async function handleSaveLearningSuggestion() {
    if (!draft || !learningSuggestion || savingLearningSuggestion) return;
    setSavingLearningSuggestion(true);
    try {
      const res = await fetch('/api/vault/learning-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: draft.id, suggestion: learningSuggestion }),
      });
      if (res.ok) {
        setLearningSuggestionSaved(true);
        setLearningSuggestion(null);
      }
    } finally {
      setSavingLearningSuggestion(false);
    }
  }

  async function handleSaveAsTemplate() {
    if (!draft || savingTemplate || savedTemplate) return;
    setSavingTemplate(true);
    try {
      const res = await fetch('/api/viral-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: twitterContent || draft.content }),
      });
      const data = await res.json();
      if (res.ok && data.name) {
        setSavedTemplate({ name: data.name });
      }
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleGenerateFromIdea(forceCredits = false) {
    if (!draft || generating) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: twitterContent || draft.content,
          length: 'auto',
          useTemplate,
          chat: forceCredits || undefined,
        }),
      });
      const data = await res.json() as { twitter?: string; linkedin?: string; imageUrl?: string; recommendedImage?: RecommendedImage; sourceInputs?: DraftSourceInput[]; type?: string; limit?: number };
      if (data.type === 'daily_limit_reached') {
        setLimitModal({ limit: data.limit ?? 3, retryFn: async () => {
          setLimitModal(null);
          await handleGenerateFromIdea(true);
        }});
        setGenerating(false);
        return;
      }
      if (!data.twitter) { setGenerating(false); return; }
      const newContent = data.twitter;
      const newLinkedin = data.linkedin ?? '';
      const newImageUrl = data.imageUrl ?? imageUrl;
      onContentChange(draft.id, newContent, newLinkedin || undefined);
      if (data.imageUrl) {
        setImageUrl(data.imageUrl);
        onImageChange?.(draft.id, data.imageUrl);
      }
      if (data.recommendedImage) setRecommendedImage(data.recommendedImage);
      if (data.sourceInputs?.length || data.recommendedImage || data.imageUrl) {
        await fetch(`/api/drafts/${draft.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceInputs: data.sourceInputs ?? [],
            imageUrl: newImageUrl,
            recommendedImage: data.recommendedImage,
          }),
        }).catch(() => {});
        const refreshed = await fetch(`/api/drafts/${draft.id}/sources`)
          .then(r => r.ok ? r.json() : { sources: [] })
          .catch(() => ({ sources: [] })) as { sources?: DraftSourceRecord[] };
        setSources(refreshed.sources ?? []);
      }
      setTwitterContent(newContent);
      setLinkedinContent(newLinkedin);
      onStatusChange(draft.id, 'drafts');
    } catch {}
    finally { setGenerating(false); }
  }

  function handleAdvance() {
    if (!draft) return;
    const next = NEXT_STATUS[draft.status];
    if (next) onStatusChange(draft.id, next);
  }

  const column = COLUMNS.find(c => c.id === draft?.status);
  const nextStatus = draft ? NEXT_STATUS[draft.status] : null;
  const nextColumn = COLUMNS.find(c => c.id === nextStatus);

  const charInfo = activePlatform === 'twitter'
    ? `${activeContent.length} chars`
    : `${activeContent.split(/\s+/).filter(Boolean).length} words`;

  return (
    <>
      {limitModal && (
        <LimitReachedModal
          limit={limitModal.limit}
          onUseCredits={limitModal.retryFn}
          onClose={() => setLimitModal(null)}
        />
      )}

      <DrawerCoachmarks isOpen={isOpen} />

      <div
        className={`fixed inset-0 bg-foreground/10 z-40 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      <div
        className={`fixed top-0 right-0 h-full w-[44%] min-w-[440px] bg-card border-l border-border z-50
          flex flex-col shadow-xl transition-transform duration-200
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {draft && (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: column?.dot }} />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{column?.label}</span>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Platform tabs (when both exist) */}
            {hasBoth && (
              <div className="flex border-b border-border shrink-0">
                {(['twitter', 'linkedin'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => { setActivePlatform(p); setMode('preview'); setRevisedContent(null); setReviseBase(null); setRevisionOriginal(null); setRevisionInstructions([]); }}
                    className={`flex-1 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                      activePlatform === p
                        ? 'border-foreground text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {p === 'twitter' ? 'X / Twitter' : 'LinkedIn'}
                  </button>
                ))}
              </div>
            )}

            {/* Char info + Improve-with-AI button (mode tabs removed) */}
            <div className="flex items-center gap-2 px-5 pt-4 pb-1 shrink-0">
              <button
                data-tour="drawer-revise"
                onClick={() => { setMode(mode === 'revise' ? 'preview' : 'revise'); setRevisedContent(null); setReviseBase(null); setRevisionOriginal(null); setRevisionInstructions([]); setReviseInstruction(''); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  mode === 'revise'
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                <Sparkles size={11} />
                {mode === 'revise' ? 'Close revise' : 'Improve with AI'}
              </button>
              <span className="ml-auto tabular text-[11px] text-muted-foreground">{charInfo}</span>
            </div>

            {/* Body */}
            <div ref={bodyRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

              {/* Skill learned notification */}
              {learnedSkill && (
                <div className="flex items-start gap-2.5 bg-[#529E63]/10 border border-[#529E63]/20 rounded-lg px-3.5 py-3">
                  <Brain size={14} className="text-[#529E63] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#529E63]">Noted: {learnedSkill.name}</p>
                    {learnedSkill.body && (
                      <p className="text-xs text-[#529E63]/90 mt-0.5">{learnedSkill.body}</p>
                    )}
                    <p className="text-xs text-[#529E63]/70 mt-0.5">Every future draft applies this automatically.</p>
                  </div>
                  <button onClick={() => setLearnedSkill(null)} className="ml-auto shrink-0 text-[#529E63]/60 hover:text-[#529E63]">
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* Content area */}
              {mode === 'preview' && (
                <>
                  {draft.status === 'ideas' ? (
                    // Ideas: just an editable textarea, no post mockup yet
                    <div className="space-y-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Idea</p>
                      <textarea
                        value={twitterContent}
                        onChange={e => {
                          const v = e.target.value;
                          setTwitterContent(v);
                          onContentChange(draft.id, v, linkedinContent || undefined);
                        }}
                        rows={8}
                        className="w-full text-sm text-foreground bg-background border border-border rounded-md px-3 py-2.5 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  ) : (
                    <>
                      {/* Live mockup, updates as you edit below */}
                      {activePlatform === 'twitter'
                        ? <TwitterMockup text={activeContent} profile={profile} />
                        : <LinkedInMockup text={activeContent} profile={profile} />
                      }

                      {/* Inline editor, auto-saves on every keystroke (parent debounces persistence) */}
                      <div className="space-y-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                          Edit {activePlatform === 'twitter' ? 'X post' : 'LinkedIn post'}
                        </p>
                        <textarea
                          value={activeContent}
                          onChange={e => {
                            const v = e.target.value;
                            if (activePlatform === 'twitter') {
                              setTwitterContent(v);
                              onContentChange(draft.id, v, linkedinContent || undefined);
                            } else {
                              setLinkedinContent(v);
                              // LinkedIn-only drafts store the body in `content`, not `linkedinContent`.
                              // Otherwise the In Progress card list shows the now-blank twitterContent.
                              if (draft.platform === 'linkedin') {
                                onContentChange(draft.id, v, undefined);
                              } else {
                                onContentChange(draft.id, twitterContent, v);
                              }
                            }
                          }}
                          rows={6}
                          className="w-full text-sm text-foreground bg-background border border-border rounded-md px-3 py-2.5 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                    </>
                  )}

                  {/* Image gen */}
                  {(imageUrl || imageGenerating || imageError) ? (
                    <div className="rounded-lg overflow-hidden border border-border">
                      {imageGenerating && (
                        <div className="flex items-center gap-2 px-3.5 py-3 text-muted-foreground">
                          <Loader2 size={13} className="animate-spin" />
                          <span className="text-xs">Generating image...</span>
                        </div>
                      )}
                      {imageError && !imageGenerating && (
                        <p className="text-xs text-destructive px-3.5 py-3">{imageError}</p>
                      )}
                      {imageUrl && !imageGenerating && (
                        <div>
                          <div className="relative group">
                            <img
                              src={imageUrl}
                              alt="Generated visual"
                              className="w-full object-cover"
                              style={{ aspectRatio: imageSize === 'square' ? '1/1' : imageSize === 'landscape' ? '16/9' : '2/1' }}
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                              <button
                                onClick={handleRemoveImage}
                                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 bg-white/90 text-black rounded-md font-medium hover:bg-white transition-colors"
                              >
                                <Trash2 size={11} /> Remove
                              </button>
                            </div>
                          </div>
                          {recommendedImage && (
                            <div className="px-3 py-2.5 border-t border-border bg-muted/30">
                              <div className="flex items-center gap-2 text-[11px] font-semibold text-foreground">
                                <ImageIcon size={12} /> Recommended visual from Vault
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {[recommendedImage.filename, recommendedImage.caption].filter(Boolean).join(' · ') || 'Vault asset'}
                              </p>
                              {recommendedImage.reason && (
                                <p className="mt-1 text-[11px] text-muted-foreground">Reason: {recommendedImage.reason}</p>
                              )}
                            </div>
                          )}
                          <div className="px-3 py-2.5 flex items-center gap-2 border-t border-border">
                            <div className="flex gap-1.5 flex-1">
                              {([
                                { id: 'square',    label: '1:1',  sub: '1024×1024' },
                                { id: 'landscape', label: '16:9', sub: '1920×1080' },
                                { id: 'banner',    label: '2:1',  sub: '1200×628'  },
                              ] as const).map(opt => (
                                <button
                                  key={opt.id}
                                  onClick={() => setImageSize(opt.id)}
                                  className={`flex flex-col items-center px-2.5 py-1.5 rounded-md border text-[10px] transition-colors ${
                                    imageSize === opt.id
                                      ? 'border-foreground text-foreground bg-muted'
                                      : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
                                  }`}
                                >
                                  <span className="font-semibold">{opt.label}</span>
                                  <span className="text-[9px] opacity-60">{opt.sub}</span>
                                </button>
                              ))}
                            </div>
                            <button
                              onClick={handleGenerateImage}
                              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity shrink-0"
                            >
                              <ImageIcon size={11} /> Regenerate
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-1.5">
                        {([
                          { id: 'square',    label: '1:1',  sub: '1024×1024' },
                          { id: 'landscape', label: '16:9', sub: '1920×1080' },
                          { id: 'banner',    label: '2:1',  sub: '1200×628'  },
                        ] as const).map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => setImageSize(opt.id)}
                            className={`flex flex-col items-center px-2.5 py-1.5 rounded-md border text-[10px] transition-colors ${
                              imageSize === opt.id
                                ? 'border-foreground text-foreground bg-muted'
                                : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
                            }`}
                          >
                            <span className="font-semibold">{opt.label}</span>
                            <span className="text-[9px] opacity-60">{opt.sub}</span>
                          </button>
                        ))}
                      </div>
                      <button
                        data-tour="drawer-image"
                        onClick={handleGenerateImage}
                        disabled={imageGenerating}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors disabled:opacity-40 font-medium"
                      >
                        <ImageIcon size={12} /> Generate image
                      </button>
                    </div>
                  )}

                </>
              )}

              {mode === 'edit' && (
                <div className="space-y-2">
                  <textarea
                    ref={textareaRef}
                    value={activeContent}
                    onChange={e => setActiveContent(e.target.value)}
                    className="w-full text-sm text-foreground bg-background border border-border rounded-md px-3 py-2.5 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    rows={12}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      className="text-xs px-3 py-1.5 bg-foreground text-background rounded-md hover:opacity-90 transition-opacity"
                    >
                      Save
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="text-xs px-3 py-1.5 border border-border rounded-md text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {mode === 'revise' && (
                <div className="space-y-4">
                  {/* Current / base content preview */}
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                      {reviseBase ? 'Working from revision' : 'Current'}
                    </p>
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap border border-border rounded-md px-3 py-2.5 bg-background line-clamp-4">
                      {reviseBase ?? activeContent}
                    </p>
                  </div>

                  {/* Revision instruction */}
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">What should change?</p>
                    <textarea
                      ref={instructionRef}
                      value={reviseInstruction}
                      onChange={e => setReviseInstruction(e.target.value)}
                      placeholder="e.g. make the hook more specific, add a number to the opening, shorten the ending..."
                      rows={3}
                      className="w-full text-sm text-foreground bg-background border border-border rounded-md px-3 py-2.5 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
                    />
                    <button
                      onClick={handleRevise}
                      disabled={!reviseInstruction.trim() || revising}
                      className="mt-2 flex items-center gap-1.5 text-xs px-3.5 py-1.5 bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-40 font-medium"
                    >
                      {revising ? (
                        <><Loader2 size={12} className="animate-spin" /> Revising...</>
                      ) : (
                        <><Sparkles size={12} /> Generate revision</>
                      )}
                    </button>
                  </div>

                  {/* Revised output */}
                  {revisedContent && (
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Revised version</p>
                      <div className="border border-[#529E63]/40 rounded-md overflow-hidden">
                        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap px-3 py-2.5 bg-background">
                          {revisedContent}
                        </p>
                        <div className="flex flex-wrap gap-2 px-3 py-2.5 border-t border-border bg-muted/30">
                          <button
                            onClick={handleAcceptRevision}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#529E63] text-white rounded-md hover:opacity-90 transition-opacity font-medium"
                          >
                            <Check size={11} />
                            Use this
                          </button>
                          <button
                            onClick={handleReviseFromRevised}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-foreground text-background rounded-md hover:opacity-90 transition-opacity font-medium"
                          >
                            <Sparkles size={11} />
                            Revise further
                          </button>
                          <button
                            onClick={() => {
                              setRevisedContent(null);
                              setLearningSuggestion(null);
                              setLearningSuggestionSaved(false);
                            }}
                            className="text-xs px-3 py-1.5 border border-border rounded-md text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Discard
                          </button>
                        </div>
                        {learningSuggestion && (
                          <div className="border-t border-border bg-background px-3 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-medium text-foreground">Save this preference to Vault?</p>
                                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{learningSuggestion.title}</p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <button
                                  onClick={handleSaveLearningSuggestion}
                                  disabled={savingLearningSuggestion}
                                  className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background disabled:opacity-50"
                                >
                                  {savingLearningSuggestion ? <Loader2 size={11} className="animate-spin" /> : <Brain size={11} />}
                                  Save
                                </button>
                                <button
                                  onClick={() => setLearningSuggestion(null)}
                                  className="rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                                >
                                  Dismiss
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                        {learningSuggestionSaved && (
                          <div className="border-t border-border bg-background px-3 py-2 text-[11px] text-[#529E63]">
                            Saved preference to Vault.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Sources used */}
              <div className="pt-2 border-t border-border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sources used</span>
                  {sourcesLoading && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
                </div>
                {sources.length > 0 ? (
                  <div className="space-y-2">
                    {sources.map(source => (
                      <div key={source.id} className="rounded-md border border-border bg-background px-3 py-2">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                            {source.kind === 'asset' ? 'Visual' : source.noteType ?? 'Note'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-foreground">{source.title}</p>
                            {source.reason && <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{source.reason}</p>}
                            {source.subtitle && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/80">{source.subtitle}</p>}
                          </div>
                          {typeof source.relevanceScore === 'number' && (
                            <span className="text-[10px] tabular-nums text-muted-foreground">{Math.round(source.relevanceScore)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {sourcesLoading ? 'Loading source trace...' : 'No source trace recorded for this draft yet.'}
                  </p>
                )}
              </div>

              {/* Format / template controls */}
              <div className="pt-2 border-t border-border space-y-2">
                {draft.status === 'ideas' ? (
                  // Ideas: toggle to write using a proven format from the library
                  <button
                    data-tour="drawer-format"
                    onClick={() => onUseTemplateChange?.(!useTemplate)}
                    className={`flex items-center gap-1.5 text-xs transition-colors ${
                      useTemplate ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <LayoutTemplate size={13} />
                    {useTemplate ? 'Using a proven format' : 'Use a proven format'}
                    {useTemplate && <span className="ml-1 text-[10px] text-amber-500">might affect voice</span>}
                  </button>
                ) : (
                  // Non-ideas: save current post as template
                  (twitterContent || draft.content) && (
                    savedTemplate ? (
                      <div className="flex items-center gap-2 text-xs text-[#529E63]">
                        <Check size={13} />
                        <span>Saved as <span className="font-medium">&quot;{savedTemplate.name}&quot;</span></span>
                      </div>
                    ) : (
                      <button
                        onClick={handleSaveAsTemplate}
                        disabled={savingTemplate}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                      >
                        {savingTemplate ? (
                          <><Loader2 size={12} className="animate-spin" /> Saving template...</>
                        ) : (
                          <><BookmarkPlus size={13} /> Save as viral template</>
                        )}
                      </button>
                    )
                  )
                )}
              </div>

              {/* Metadata */}
              <div className="pt-2 border-t border-border space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Created</span>
                  <span className="text-foreground tabular">
                    {new Date(draft.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              </div>

              {/* Move to */}
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Move to</span>
                <div className="flex flex-wrap gap-1.5">
                  {COLUMNS.filter(c => c.id !== draft.status).map(col => (
                    <button
                      key={col.id}
                      onClick={() => onStatusChange(draft.id, col.id)}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors"
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: col.dot }} />
                      {col.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Schedule to X */}
              {draft.status !== 'posted' && (
                <div className="pt-2 border-t border-border">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Schedule to X</span>
                  {scheduleError && (
                    <p className="text-[11px] text-destructive mb-2">{scheduleError}</p>
                  )}
                  {scheduledOk ? (
                    <p className="text-xs text-[#529E63] flex items-center gap-1.5">
                      <Check size={12} /> Scheduled. Lore posts it automatically.
                    </p>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="datetime-local"
                        value={scheduleAt}
                        onChange={e => setScheduleAt(e.target.value)}
                        className="flex-1 text-xs bg-background border border-border rounded-md px-2 py-1.5 text-foreground"
                      />
                      <button
                        onClick={handleSchedule}
                        disabled={scheduling || !scheduleAt}
                        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors disabled:opacity-50"
                      >
                        {scheduling ? <Loader2 size={12} className="animate-spin" /> : <CalendarClock size={12} />}
                        Schedule
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {nextColumn && (
              <div className="px-5 py-4 border-t border-border shrink-0">
                {draft.status === 'ideas' ? (
                  <button
                    onClick={() => handleGenerateFromIdea()}
                    disabled={generating}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {generating ? (
                      <><Loader2 size={15} className="animate-spin" /> Generating...</>
                    ) : (
                      <>
                        <Sparkles size={15} />
                        {useTemplate ? 'Generate with viral template' : 'Generate & move to Drafts'}
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleAdvance}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    Move to {nextColumn.label}
                    <ChevronRight size={15} />
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
