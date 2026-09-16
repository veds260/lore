'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Sparkles, ChevronDown, Loader2, Zap, RefreshCw, ImageIcon, RotateCcw, Trash2 } from 'lucide-react';
import type { DraftSourceInput, DraftStatus, Platform, PostLength, RecommendedImage } from './types';
import { LimitReachedModal } from '@/components/ui/limit-reached-modal';
import { useModKey } from '@/components/ui/mod-key';

export interface NewDraft {
  content: string;
  linkedinContent?: string;
  imageUrl?: string;
  recommendedImage?: RecommendedImage;
  sourceInputs?: DraftSourceInput[];
  platform: Platform;
  status: DraftStatus;
  templateId?: string;
}

interface DraftComposerProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (draft: NewDraft) => void;
  initialTopic?: string;
}

interface SelectedTemplate {
  id: string;
  name: string;
  description: string;
  format: string;
  postLength: string;
}

const USED_TEMPLATES_KEY = 'lore:used-templates';
const MAX_HISTORY = 8;

function getUsedTemplates(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(USED_TEMPLATES_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function recordTemplateUsed(id: string) {
  if (typeof window === 'undefined') return;
  const used = getUsedTemplates().filter(t => t !== id);
  used.unshift(id);
  localStorage.setItem(USED_TEMPLATES_KEY, JSON.stringify(used.slice(0, MAX_HISTORY)));
}

const PLATFORM_TABS: { id: Platform; label: string }[] = [
  { id: 'twitter',  label: 'X / Twitter' },
  { id: 'linkedin', label: 'LinkedIn' },
];

const LENGTH_OPTIONS: { id: PostLength; label: string; hint: string }[] = [
  { id: 'auto',   label: 'Auto',   hint: 'Platform default' },
  { id: 'short',  label: 'Short',  hint: 'X: ~140 chars · LI: ~100 words' },
  { id: 'medium', label: 'Medium', hint: 'X: ~240 chars · LI: ~400 words' },
  { id: 'long',   label: 'Long',   hint: 'X: Thread · LI: ~800 words' },
];

const FORMAT_LABELS: Record<string, string> = {
  prose: 'Prose',
  list: 'Numbered list',
  thread: 'Thread',
};

function CharCount({ text, platform }: { text: string; platform: Platform }) {
  const LIMIT = platform === 'twitter' ? 280 : 3000;
  const count = platform === 'twitter' ? text.length : text.split(/\s+/).filter(Boolean).length;
  const label = platform === 'twitter' ? `${count} / ${LIMIT} chars` : `${count} words`;
  const over = platform === 'twitter' && text.length > LIMIT;
  return (
    <span className={`tabular-nums text-[11px] font-medium ${over ? 'text-destructive' : 'text-muted-foreground'}`}>
      {label}
    </span>
  );
}

export function DraftComposer({ isOpen, onClose, onSave, initialTopic }: DraftComposerProps) {
  const mod = useModKey();
  const [activePlatform, setActivePlatform] = useState<Platform>('twitter');
  const [twitterContent, setTwitterContent] = useState('');
  const [linkedinContent, setLinkedinContent] = useState('');
  const [topic, setTopic] = useState('');
  const [length, setLength] = useState<PostLength>('auto');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  // mode is always 'both' now, kept as a constant so existing references continue working
  const mode = 'both' as const;

  // Image generation state
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageError, setImageError] = useState('');
  const [imageSize, setImageSize] = useState<'square' | 'landscape' | 'banner'>('square');
  const [sourceInputs, setSourceInputs] = useState<DraftSourceInput[]>([]);
  const [recommendedImage, setRecommendedImage] = useState<RecommendedImage | null>(null);

  // Viral template state
  const [viralMode, setViralMode] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<SelectedTemplate | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [limitModal, setLimitModal] = useState<{ limit: number; retryFn: () => Promise<void> } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const topicRef = useRef<HTMLTextAreaElement>(null);

  const activeContent = activePlatform === 'twitter' ? twitterContent : linkedinContent;
  const setActiveContent = activePlatform === 'twitter' ? setTwitterContent : setLinkedinContent;

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTopic(initialTopic ?? '');
      setTwitterContent('');
      setLinkedinContent('');
      setGenerateError('');
      setShowAdvanced(false);
      setViralMode(false);
      setSelectedTemplate(null);
      setImageUrl(null);
      setSourceInputs([]);
      setRecommendedImage(null);
      setImageError('');
      setTimeout(() => topicRef.current?.focus(), 50);
    }
  }, [isOpen, initialTopic]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSave('drafts');
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, twitterContent, linkedinContent, mode, activePlatform]);

  async function fetchTemplate(forceRefresh = false) {
    setLoadingTemplate(true);
    try {
      const used = getUsedTemplates();
      const excludeCount = forceRefresh ? 3 : 5;
      const exclude = used.slice(0, excludeCount);
      const params = new URLSearchParams();
      if (exclude.length > 0) params.set('exclude', exclude.join(','));
      if (topic.trim()) params.set('topic', topic.trim());
      const res = await fetch(`/api/viral-templates?${params.toString()}`);
      if (!res.ok) throw new Error('Failed');
      const data: SelectedTemplate = await res.json();
      setSelectedTemplate(data);
    } catch {
      // silently fail, keep whatever was selected
    } finally {
      setLoadingTemplate(false);
    }
  }

  async function handleViralToggle() {
    const next = !viralMode;
    setViralMode(next);
    if (next && !selectedTemplate) {
      await fetchTemplate();
    }
  }

  async function handleGenerate(forceCredits = false) {
    if (!topic.trim() && !twitterContent.trim() && !linkedinContent.trim()) return;
    setGenerating(true);
    setGenerateError('');
    try {
      // The composer generates for the currently active platform tab only.
      // To get both platforms, the user generates on one tab, switches, and
      // generates on the other. Platforms stay separate on purpose.
      const platform: 'twitter' | 'linkedin' = activePlatform === 'linkedin' ? 'linkedin' : 'twitter';
      const body: Record<string, unknown> = {
        topic: topic.trim() || activeContent,
        length,
        chat: forceCredits || undefined,
        platform,
      };
      if (viralMode && selectedTemplate) {
        body.templateId = selectedTemplate.id;
        recordTemplateUsed(selectedTemplate.id);
      }
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { twitter?: string; linkedin?: string; imageUrl?: string; recommendedImage?: RecommendedImage; sourceInputs?: DraftSourceInput[]; error?: string; type?: string; limit?: number };
      if (!res.ok) {
        if (data.type === 'daily_limit_reached') {
          setLimitModal({ limit: data.limit ?? 3, retryFn: async () => {
            setLimitModal(null);
            await handleGenerate(true);
          }});
          return;
        }
        throw new Error(data.error ?? 'Generation failed');
      }
      if (data.twitter) setTwitterContent(data.twitter);
      if (data.linkedin) setLinkedinContent(data.linkedin);
      if (data.imageUrl) setImageUrl(data.imageUrl);
      if (data.recommendedImage) setRecommendedImage(data.recommendedImage);
      if (data.sourceInputs) setSourceInputs(data.sourceInputs);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateImage() {
    const content = twitterContent.trim() || linkedinContent.trim();
    if (!content) return;
    setImageGenerating(true);
    setImageError('');
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, size: imageSize }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Image generation failed');
      setImageUrl(data.imageUrl);
      setRecommendedImage(null);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Image generation failed');
    } finally {
      setImageGenerating(false);
    }
  }

  function handleSave(status: DraftStatus) {
    const primary = mode === 'both'
      ? twitterContent
      : activePlatform === 'twitter' ? twitterContent : linkedinContent;

    if (!primary.trim() && !linkedinContent.trim()) return;

    const platform: Platform = mode === 'both' ? 'both' : activePlatform;

    onSave({
      content: primary.trim() || linkedinContent.trim(),
      linkedinContent: mode === 'both' && linkedinContent.trim() ? linkedinContent.trim() : undefined,
      imageUrl: imageUrl ?? undefined,
      recommendedImage: recommendedImage ?? undefined,
      sourceInputs,
      platform,
      status,
      templateId: selectedTemplate?.id ?? undefined,
    });

    setTwitterContent('');
    setLinkedinContent('');
    setTopic('');
    onClose();
  }

  const hasContent = twitterContent.trim() || linkedinContent.trim();

  return (
    <>
      {limitModal && (
        <LimitReachedModal
          limit={limitModal.limit}
          onUseCredits={limitModal.retryFn}
          onClose={() => setLimitModal(null)}
        />
      )}

      <div
        className={`fixed inset-0 bg-foreground/10 z-40 transition-opacity ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      <div
        className={`fixed top-0 right-0 h-full w-[500px] bg-card border-l border-border z-50
          flex flex-col shadow-xl transition-transform duration-200
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <span className="text-sm font-semibold">New post</span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* Topic input */}
          <div className="px-5 pt-4 pb-3 border-b border-border">
            <textarea
              ref={topicRef}
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="What do you want to write about? Paste a link, describe an idea, or write a rough draft..."
              rows={2}
              className="w-full text-sm text-foreground bg-background border border-border rounded-md px-3 py-2.5 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
            />

            {/* Viral template strip, shown when active */}
            {viralMode && (
              <div className="mt-2 flex items-center gap-2 bg-amber-500/[0.06] border border-amber-500/20 rounded-md px-3 py-2">
                {loadingTemplate ? (
                  <Loader2 size={12} className="text-amber-500 animate-spin shrink-0" />
                ) : (
                  <Zap size={12} className="text-amber-500 shrink-0" />
                )}
                {selectedTemplate ? (
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-amber-600">{selectedTemplate.name}</span>
                    <span className="text-[10px] text-amber-600/70 ml-1.5">
                      {FORMAT_LABELS[selectedTemplate.format] ?? selectedTemplate.format}
                    </span>
                    <p className="text-[10px] text-amber-600/60 mt-0.5 truncate">{selectedTemplate.description}</p>
                  </div>
                ) : (
                  <span className="text-xs text-amber-600/70 flex-1">Picking template...</span>
                )}
                <button
                  onClick={() => fetchTemplate(true)}
                  disabled={loadingTemplate}
                  className="shrink-0 p-1 text-amber-500/60 hover:text-amber-500 transition-colors disabled:opacity-40"
                  title="Pick a different template"
                >
                  <RefreshCw size={11} />
                </button>
              </div>
            )}

            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2">
                {/* Advanced toggle */}
                <button
                  onClick={() => setShowAdvanced(v => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown size={12} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                  Advanced
                </button>

                {/* Viral template toggle */}
                <button
                  onClick={handleViralToggle}
                  disabled={loadingTemplate}
                  className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border transition-colors font-medium ${
                    viralMode
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/15'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
                  }`}
                >
                  <Zap size={11} className={viralMode ? 'text-amber-500' : ''} />
                  Viral template
                </button>
              </div>

              {/* Generate button */}
              <button
                onClick={() => handleGenerate()}
                disabled={generating || (!topic.trim() && !hasContent)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {generating ? 'Generating...' : 'Generate'}
              </button>
            </div>

            {/* Advanced panel */}
            {showAdvanced && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Length</p>
                <div className="flex gap-1.5">
                  {LENGTH_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setLength(opt.id)}
                      title={opt.hint}
                      className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors font-medium ${
                        length === opt.id
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  {LENGTH_OPTIONS.find(o => o.id === length)?.hint}
                </p>
              </div>
            )}

            {generateError && (
              <p className="text-xs text-destructive mt-2">{generateError}</p>
            )}
          </div>

          {/* Platform tabs */}
          <div className="flex border-b border-border shrink-0">
            {PLATFORM_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActivePlatform(tab.id)}
                className={`flex-1 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                  activePlatform === tab.id
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
                {(tab.id === 'twitter' ? twitterContent : linkedinContent).trim() && (
                  <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-[#529E63] inline-block" />
                )}
              </button>
            ))}
          </div>

          {/* Content textarea */}
          <div className="flex-1 px-5 py-4 flex flex-col gap-2">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {viralMode && selectedTemplate
                ? `Using: ${selectedTemplate.name}: ${selectedTemplate.description}`
                : activePlatform === 'twitter'
                  ? 'Hook first. Lead with a name, scenario, or contrast, not the topic itself. Max 280 chars for single tweet, or numbered thread.'
                  : 'Professional but personal. Build context before the insight. Longer is fine if it earns it.'}
            </p>
            <textarea
              ref={textareaRef}
              value={activeContent}
              onChange={e => setActiveContent(e.target.value)}
              placeholder={activePlatform === 'twitter'
                ? 'Write your X post here, or hit Generate...'
                : 'Write your LinkedIn post here, or hit Generate...'}
              className="flex-1 w-full min-h-[200px] text-sm text-foreground bg-background border border-border rounded-md px-3 py-2.5 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Image preview */}
        {(imageUrl || imageGenerating || imageError) && (
          <div className="px-5 pb-3 shrink-0">
            {imageGenerating && (
              <div className="flex items-center gap-2 h-[120px] border border-border rounded-lg bg-muted/30 justify-center">
                <Loader2 size={16} className="animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Generating image...</span>
              </div>
            )}
            {imageError && !imageGenerating && (
              <p className="text-xs text-destructive">{imageError}</p>
            )}
            {imageUrl && !imageGenerating && (
              <div className="relative group rounded-lg overflow-hidden border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Generated visual" className="w-full h-[160px] object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                  <button
                    onClick={handleGenerateImage}
                    className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 bg-white/90 text-black rounded-md font-medium hover:bg-white transition-colors"
                  >
                    <RotateCcw size={11} />
                    Regenerate
                  </button>
                  <button
                    onClick={() => { setImageUrl(null); setImageError(''); }}
                    className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 bg-white/90 text-black rounded-md font-medium hover:bg-white transition-colors"
                  >
                    <Trash2 size={11} />
                    Remove
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border shrink-0 flex items-center justify-between gap-3">
          <CharCount text={activeContent} platform={activePlatform} />
          <div className="flex items-center gap-2">
            {/* Image gen: size picker + button, only when content exists */}
            {hasContent && (
              <div className="flex items-center gap-1.5">
                {([
                  { id: 'square',    label: '1:1',  sub: '1024×1024' },
                  { id: 'landscape', label: '16:9', sub: '1920×1080' },
                  { id: 'banner',    label: '2:1',  sub: '1200×628'  },
                ] as const).map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setImageSize(opt.id)}
                    title={opt.sub}
                    className={`flex flex-col items-center px-2 py-1 rounded border text-[10px] transition-colors ${
                      imageSize === opt.id
                        ? 'border-foreground text-foreground bg-muted'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
                    }`}
                  >
                    <span className="font-semibold leading-none">{opt.label}</span>
                    <span className="opacity-50 leading-none mt-0.5">{opt.sub}</span>
                  </button>
                ))}
                <button
                  onClick={handleGenerateImage}
                  disabled={imageGenerating}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors disabled:opacity-40 font-medium"
                >
                  {imageGenerating ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />}
                  {imageUrl ? 'Regen' : 'Image'}
                </button>
              </div>
            )}
            <button
              onClick={() => handleSave('ideas')}
              disabled={!hasContent}
              className="text-xs px-3.5 py-2 border border-border rounded-md text-foreground hover:bg-accent transition-colors disabled:opacity-40 font-medium"
            >
              Add to Ideas
            </button>
            <button
              onClick={() => handleSave('drafts')}
              disabled={!hasContent}
              className="text-xs px-3.5 py-2 bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-40 font-medium"
              title={mod ? `${mod === '⌘' ? '⌘ Enter' : 'Ctrl + Enter'}` : undefined}
            >
              Save Draft
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
