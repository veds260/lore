'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, RefreshCw, Sparkles, BookmarkPlus, Check, RotateCcw, Info, X } from 'lucide-react';
import type { NewDraft } from './draft-composer';
import type { Trend } from '@/app/api/trends/route';
import type { Profile } from '@/components/ui/platform-mockups';

// Maps full angle prompt → a short display label
const ANGLE_LABEL_MAP: [string, string, string][] = [
  ['qrt',           'QRT',          'bg-purple-500/10 text-purple-400'],
  ['contrarian', 'Contrarian', 'bg-rose-500/10 text-rose-500'],
  ['hot take',   'Hot take',   'bg-rose-500/10 text-rose-500'],
  ['personal story', 'Personal story', 'bg-violet-500/10 text-violet-400'],
  ['share a personal', 'Personal story', 'bg-violet-500/10 text-violet-400'],
  ['break down the data', 'Data breakdown', 'bg-sky-500/10 text-sky-400'],
  ['data breakdown', 'Data breakdown', 'bg-sky-500/10 text-sky-400'],
  ['tactical breakdown', 'Tactical', 'bg-emerald-500/10 text-emerald-400'],
  ['share a tactical', 'Tactical', 'bg-emerald-500/10 text-emerald-400'],
  ['share a specific', 'Case study', 'bg-sky-500/10 text-sky-400'],
];

function angleInfo(angle: string): { label: string; cls: string } {
  const lower = angle.toLowerCase();
  const match = ANGLE_LABEL_MAP.find(([key]) => lower.includes(key));
  return match
    ? { label: match[1], cls: match[2] }
    : { label: 'Idea', cls: 'bg-amber-500/10 text-amber-500' };
}

interface GeneratedPosts { twitter: string; linkedin: string }

function GeneratedOverlay({
  trend,
  posts,
  onSave,
  onRegenerate,
  onClose,
  saved,
}: {
  trend: Trend;
  posts: GeneratedPosts;
  onSave: () => void;
  onRegenerate: () => void;
  onClose: () => void;
  saved: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div ref={ref} className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-border shrink-0">
          <div>
            <p className="text-xs font-semibold text-foreground leading-snug">
              {trend.type === 'qrt' ? 'Quote-tweet this post' : trend.headline}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Review before saving to drafts</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5">
            <X size={14} />
          </button>
        </div>

        {/* Content, scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {trend.type === 'qrt' && trend.sourceTweet && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 flex flex-col gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Quoting</p>
              <p className="text-xs text-foreground leading-relaxed italic">
                &ldquo;{trend.sourceTweet.text.length > 240
                  ? trend.sourceTweet.text.slice(0, 240) + '…'
                  : trend.sourceTweet.text}&rdquo;
              </p>
              <a
                href={trend.sourceTweet.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2 mt-0.5"
              >
                @{trend.sourceTweet.authorHandle} · {trend.sourceTweet.likeCount.toLocaleString()} likes ↗
              </a>
            </div>
          )}
          {trend.type === 'mainstream' && trend.mainstream && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 flex flex-col gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">News source</p>
              <a
                href={trend.mainstream.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
              >
                {trend.mainstream.source} ↗
              </a>
            </div>
          )}
          <div>
            {trend.type === 'qrt' && (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Your QRT caption</p>
            )}
            {trend.type === 'mainstream' && (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">LinkedIn news reaction</p>
            )}
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
              {trend.type === 'mainstream' ? posts.linkedin : posts.twitter}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 py-3.5 border-t border-border flex items-center gap-2 shrink-0">
          <button
            onClick={onSave}
            disabled={saved}
            className={`flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-md transition-all ${
              saved
                ? 'bg-[#529E63]/10 text-[#529E63] border border-[#529E63]/20'
                : 'bg-foreground text-background hover:opacity-90'
            }`}
          >
            {saved ? <><Check size={11} /> Saved to Drafts</> : <><BookmarkPlus size={11} /> Save as Draft</>}
          </button>
          <button
            onClick={onRegenerate}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border px-3 py-2 rounded-md transition-colors"
          >
            <RotateCcw size={11} />
            Regenerate
          </button>
          <button onClick={onClose} className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors">
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

function TrendCard({
  trend,
  onSave,
}: {
  trend: Trend;
  profile: Profile;
  onSave: (draft: NewDraft) => void;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [posts, setPosts] = useState<GeneratedPosts | null>(null);
  const [saved, setSaved] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const attemptRef = useRef(0);
  const { label, cls } = angleInfo(trend.angle);

  const REGEN_HINTS = [
    'Write from a completely different angle: different hook style, different structure, different perspective on this topic.',
    'Take an unexpected or contrarian take. Challenge the obvious interpretation. Different format and opening.',
    'Write this as a specific example or personal story angle. Different voice, different entry point.',
    'Try a data-led or tactical breakdown approach. Different structure from any previous version.',
  ];

  async function generate(attempt = 0) {
    setState('loading');
    setErrorMsg('');
    setPosts(null);
    setSaved(false);

    const variationNote = attempt > 0
      ? `\n\nIMPORTANT: ${REGEN_HINTS[(attempt - 1) % REGEN_HINTS.length]}`
      : '';

    const isQrt = trend.type === 'qrt' && trend.sourceTweet;
    const isMainstream = trend.type === 'mainstream' && trend.mainstream;

    // Platform routing per card type:
    //  - QRT cards → X only (it's a quote-tweet)
    //  - Mainstream news cards → LinkedIn only (3-takeaway format lives there)
    //  - Idea cards → both
    const platform: 'twitter' | 'linkedin' | 'both' =
      isQrt ? 'twitter' : isMainstream ? 'linkedin' : 'both';

    const topic = isQrt
      ? `Write a quote-tweet reaction to this post:\n\n"${trend.sourceTweet!.text}"\n- @${trend.sourceTweet!.authorHandle} (${trend.sourceTweet!.likeCount.toLocaleString()} likes)\n\nAdd a sharp, specific insight or take. 2-4 sentences. Do not start with "I agree" or "Great point". React directly to what they said.${variationNote}`
      : isMainstream
      ? `React to this news: "${trend.headline}"\n\nContext: ${trend.context}\n\nSource publication: ${trend.mainstream!.source} (do NOT include URLs or "Source:" lines in the post body. LinkedIn deboosts outbound links).\n\nWrite a LinkedIn post reacting to this news using the 3-takeaway structure. Close with a forward-looking declarative statement, not a question.${variationNote}`
      : `${trend.headline}\n\nContext: ${trend.context}\nContent angle: ${trend.angle}${variationNote}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          length: isQrt ? 'short' : 'auto',
          chat: true,
          directWrite: true, // skip intent classification, pulse cards are always "write this post"
          platform,
          // Mainstream news cards force the 3-takeaway News Reaction template.
          // Server resolves by name so re-seeds don't break this.
          useNewsTemplate: isMainstream || undefined,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json();
      const got = (platform === 'linkedin' ? data.linkedin : data.twitter);
      if (res.ok && got) {
        setPosts({ twitter: data.twitter ?? '', linkedin: data.linkedin ?? '' });
        setState('done');
        setOverlayOpen(true);
      } else if (data.type === 'daily_limit_reached') {
        setErrorMsg('Daily limit reached');
        setState('error');
      } else if (data.type === 'insufficient_credits') {
        setErrorMsg('Out of credits');
        setState('error');
      } else {
        setErrorMsg('Failed. Try again');
        setState('error');
      }
    } catch {
      clearTimeout(timer);
      setErrorMsg('Failed. Try again');
      setState('error');
    }
  }

  function handleSave() {
    if (!posts) return;
    // Save shape per card type:
    //  - QRT (X-only): content = tweet + source url, no LinkedIn
    //  - Mainstream news (LinkedIn-only): content = the LinkedIn post + source url
    //  - Idea (both): content = tweet, linkedinContent = LinkedIn version
    if (trend.type === 'qrt' && trend.sourceTweet) {
      onSave({
        content: `${posts.twitter}\n\n${trend.sourceTweet.url}`,
        platform: 'twitter',
        status: 'drafts',
      });
    } else if (trend.type === 'mainstream' && trend.mainstream) {
      // No source URL appended: LinkedIn's algorithm deboosts posts with
      // outbound links in the body. The article URL stays in the card's
      // metadata for the writer's reference but never lands in the post.
      onSave({
        content: posts.linkedin,
        platform: 'linkedin',
        status: 'drafts',
      });
    } else {
      onSave({ content: posts.twitter, linkedinContent: posts.linkedin, platform: 'both', status: 'drafts' });
    }
    setSaved(true);
  }

  return (
    <>
      {overlayOpen && posts && (
        <GeneratedOverlay
          trend={trend}
          posts={posts}
          onSave={handleSave}
          onRegenerate={() => { setOverlayOpen(false); attemptRef.current += 1; generate(attemptRef.current); }}
          onClose={() => setOverlayOpen(false)}
          saved={saved}
        />
      )}

      <div
        className={`flex flex-col shrink-0 w-44 rounded-lg border transition-colors cursor-default ${
          state === 'done'
            ? 'border-amber-500/30 bg-amber-500/[0.06]'
            : 'border-border bg-card hover:border-amber-500/25'
        }`}
      >
        <div className="p-2.5 flex flex-col gap-1.5">
          <div className="flex items-center gap-1 flex-wrap">
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${cls}`}>
              {trend.type === 'mainstream' ? 'News · LinkedIn' : label}
            </span>
            {trend.type === 'mainstream' && trend.mainstream && (
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider">{trend.mainstream.source}</span>
            )}
          </div>
          {trend.type === 'qrt' && trend.sourceTweet ? (
            <>
              <p className="text-[10px] text-foreground leading-snug line-clamp-3 italic">
                &ldquo;{trend.sourceTweet.text.slice(0, 120)}{trend.sourceTweet.text.length > 120 ? '…' : ''}&rdquo;
              </p>
              <p className="text-[9px] text-muted-foreground">
                @{trend.sourceTweet.authorHandle} · {trend.sourceTweet.likeCount.toLocaleString()} likes
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] font-semibold text-foreground leading-snug line-clamp-2">{trend.headline}</p>
              <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">{trend.context}</p>
            </>
          )}

          {(state === 'idle' || state === 'error') && (
            <button
              onClick={() => generate(0)}
              className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-amber-600 hover:text-amber-500 transition-colors"
            >
              <Sparkles size={10} />
              {state === 'error' ? errorMsg : trend.type === 'qrt' ? 'Generate QRT' : trend.type === 'mainstream' ? 'Generate LinkedIn post' : 'Generate post'}
            </button>
          )}

          {state === 'loading' && (
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Loader2 size={10} className="animate-spin" />
              Writing...
            </div>
          )}

          {state === 'done' && (
            <button
              onClick={() => setOverlayOpen(true)}
              className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-amber-600 hover:text-amber-500 transition-colors"
            >
              {saved ? <><Check size={10} className="text-[#529E63]" /> <span className="text-[#529E63]">Saved</span></> : <><Sparkles size={10} /> Review &amp; save</>}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// v2: bumped when QRT feature was added so stale pre-QRT cache auto-invalidates
const todayKey = () => `trends-v2-${new Date().toISOString().slice(0, 10)}`;

interface TrendsStripProps {
  onSaveDraft: (draft: NewDraft) => void;
  profile: Profile;
}

interface MissingField { field: string; label: string; why: string }

export function TrendsStrip({ onSaveDraft, profile }: TrendsStripProps) {
  const [trends, setTrends] = useState<Trend[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [missingInfo, setMissingInfo] = useState<MissingField[] | null>(null);

  async function fetchTrends(bust = false) {
    setLoading(true);
    setError(null);

    if (!bust) {
      try {
        const cached = sessionStorage.getItem(todayKey());
        if (cached) {
          const parsed = JSON.parse(cached) as { trends: Trend[]; remaining?: number; missingInfo?: MissingField[] };
          setTrends(parsed.trends);
          if (parsed.remaining !== undefined) setRemaining(parsed.remaining);
          if (parsed.missingInfo) setMissingInfo(parsed.missingInfo);
          setLoading(false);
          return;
        }
      } catch { /* ignore */ }
    }

    try {
      const res = await fetch('/api/trends');
      const data = await res.json() as { trends?: Trend[]; remaining?: number; error?: string; type?: string; missingInfo?: MissingField[] };

      if (!res.ok) {
        if (data.type === 'daily_limit_reached') {
          setError('You\'ve refreshed Today\'s Pulse 5 times today. Come back tomorrow.');
        } else if (data.type === 'insufficient_credits') {
          setError('Not enough credits to refresh. Upgrade your plan.');
        } else {
          setError('Could not load trends.');
        }
        return;
      }

      if (!data.trends) { setError('Could not load trends.'); return; }
      setTrends(data.trends);
      if (data.remaining !== undefined) setRemaining(data.remaining);
      if (data.missingInfo) setMissingInfo(data.missingInfo);
      try {
        sessionStorage.setItem(todayKey(), JSON.stringify({ trends: data.trends, remaining: data.remaining, missingInfo: data.missingInfo }));
      } catch { /* ignore */ }
    } catch {
      setError('Could not load trends.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { Promise.resolve().then(() => fetchTrends()); }, []);

  return (
    <div className="shrink-0 border-b border-border">
      <div className="px-6 py-2.5">
        <div className="flex items-center gap-2 mb-2">
          <span data-tour="pulse" className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600/80">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Today&apos;s pulse
          </span>
          {remaining !== null && remaining <= 2 && (
            <span className="text-[10px] text-muted-foreground">
              {remaining} refresh{remaining !== 1 ? 'es' : ''} left today
            </span>
          )}
          {missingInfo && missingInfo.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-amber-600/60">
              <Info size={9} />
              <span>
                Add{' '}
                {missingInfo.map((f, i) => (
                  <span key={f.field}>
                    <a href="/profile" className="underline underline-offset-2 hover:text-amber-500 transition-colors">
                      {f.label.toLowerCase()}
                    </a>
                    {i < missingInfo.length - 1 ? ', ' : ''}
                  </span>
                ))}{' '}
                for better trends
              </span>
            </span>
          )}
          <button
            onClick={() => fetchTrends(true)}
            disabled={loading || remaining === 0}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            title={remaining === 0 ? 'No refreshes left today' : 'Refresh trends'}
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="shrink-0 w-44 h-20 rounded-lg border border-border bg-muted/20 animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <p className="text-[11px] text-muted-foreground py-1">
            {error}{' '}
            {!error.includes('Come back') && !error.includes('credits') && (
              <button onClick={() => fetchTrends(true)} className="underline hover:text-foreground transition-colors">
                Try again
              </button>
            )}
          </p>
        )}

        {!loading && !error && trends && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {trends.map(trend => (
              <TrendCard key={trend.id} trend={trend} profile={profile} onSave={onSaveDraft} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
