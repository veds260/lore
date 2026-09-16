'use client';

import { useState, useRef, useEffect, forwardRef, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, ChevronLeft, Check, Loader2, X, Plus, Upload, AlertCircle, Copy, CheckCheck, Bot, FileText, Mic2, Wand2 } from 'lucide-react';
import { ChatOnboarding } from './chat-onboarding';

const AGENT_PROMPT = `I'm setting up Lore, a content tool that writes social media posts in my voice. Answer these questions about me based on everything you know from our conversations, then format the output as a clean markdown document I can upload.

---

**Name / Brand name:**
[Your name or the brand name you go by publicly]

**What I do and who I help:**
[1-3 sentences: your role, who your audience is, what problem you solve. Conversational, no jargon]

**My target audience:**
[Specific description of your ideal reader: their role, stage, and main challenge, e.g. "Early-stage SaaS founders pre-PMF who built something but can't get traction"]

**My unique angle / what makes my approach different:**
[What you see that others in your space miss. Your contrarian point of view. How you do things differently.]

**Key background and credentials:**
[2-4 facts that establish your authority: years of experience, notable results, companies, or credentials]

**A recent win:**
[One specific concrete result: a deal closed, a metric hit, something a client achieved. Include numbers if possible. 2-4 sentences.]

**Something I strongly believe that most people in my field get wrong:**
[Your sharpest, most specific contrarian take. Don't hedge.]

**My areas of expertise:**
[List 4-6 specific topics I know deeply]

**My recurring content themes:**
[The angles and ideas I keep coming back to in my content]

**My writing style:**
[3-5 adjectives that describe how I write]

**X / Twitter handle:**
[handle without @, or leave blank]

**LinkedIn handle:**
[your-slug, or leave blank]

---

Output only the filled-in markdown. No preamble, no explanation.`;


const VIBES = [
  {
    id: 'direct',
    label: 'Direct & punchy',
    post: '87% of founders who hire a ghostwriter quit within 3 months.\n\nNot because the writing was bad.\n\nBecause nobody explained upfront that the goal is building proof you know your field, not going viral.',
    cue: 'Short. Specific numbers. Says what others dance around.',
  },
  {
    id: 'story',
    label: 'Story-first',
    post: "I rewrote my first 50 posts before I published any of them.\n\nI thought that was the problem.\n\nTurns out it was the practice. The rewrites were always better, and chasing that gap made my writing a lot sharper.",
    cue: 'Opens with a scene. Lesson comes at the end, not the front.',
  },
  {
    id: 'educator',
    label: 'Educator',
    post: "Here's what nobody tells you about content consistency:\n\n1. The algorithm rewards predictability more than quality\n2. Your audience needs 7+ touchpoints before they trust you\n3. Showing up > being brilliant\n\nConsistency is the strategy, not the tactic.",
    cue: 'Numbered or structured. Teaches something. Clear takeaway.',
  },
];

const PLATFORMS = [
  { id: 'twitter', label: 'X / Twitter' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'both', label: 'Both' },
] as const;

const VIBE_SUGGESTIONS: Record<string, string[]> = {
  direct:   ['naval', 'paulg', 'sama', 'Jason', 'auren'],
  story:    ['dickiebush', 'Nicolascole77', 'Julian', 'harrisonmetal'],
  educator: ['tferriss', 'jamesaclear', 'david_perell', 'ShaneAParrish'],
};

type PlatformId = (typeof PLATFORMS)[number]['id'];
type VibeId = 'direct' | 'story' | 'educator' | '';

type ContentStyleId = 'witty-short' | 'deep-value' | 'mixed';

const CONTENT_STYLES: { id: ContentStyleId; label: string; cue: string; post: string }[] = [
  {
    id: 'witty-short',
    label: 'Witty & sharp',
    cue: 'Short. Punchy hook. Trusts the reader to get it fast.',
    post: 'The dev environment just became the commute.\n\nThe gap between having an idea and shipping something real keeps shrinking.\n\nMost people still haven\'t adjusted their assumptions.',
  },
  {
    id: 'deep-value',
    label: 'Deep & valuable',
    cue: 'Substantive. Real insight. Makes people save and re-read.',
    post: 'Vibe coding didn\'t lower the barrier to shipping.\n\nIt lowered the barrier to starting, which forced founders to stop and ask if they actually wanted to build what they thought they did.\n\nThe bottleneck was never code. It was conviction. Now there\'s nowhere left to hide behind the build.',
  },
  {
    id: 'mixed',
    label: 'Mix of both',
    cue: 'Varies by topic. Some punchy, some in-depth.',
    post: 'Some posts are tight one-liners. Others unpack a mechanism. Lore reads the topic and picks the format that fits. Not every idea needs the same treatment.',
  },
];

interface WizardState {
  name: string;
  twitterHandle: string;
  linkedinHandle: string;
  whatYouDo: string;
  platform: PlatformId;
  audience: string;
  positioning: string;
  backgroundSummary: string;
  recentWin: string;
  strongBelief: string;
  vibe: VibeId;
  contentStyle: ContentStyleId;
  inspirationHandles: string[];
  // Richer context from AI profile parse
  expertise?: string[];
  credibilityMarkers?: string[];
  writingTone?: string[];
  contentThemes?: string[];
}

const INITIAL: WizardState = {
  name: '',
  twitterHandle: '',
  linkedinHandle: '',
  whatYouDo: '',
  platform: 'twitter',
  audience: '',
  positioning: '',
  backgroundSummary: '',
  recentWin: '',
  strongBelief: '',
  vibe: '',
  contentStyle: 'mixed',
  inspirationHandles: [],
};

const TOTAL = 7;

function Progress({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-10">
      {Array.from({ length: TOTAL }).map((_, i) => (
        <div
          key={i}
          className={`h-1 flex-1 rounded-full transition-all ${
            i < step ? 'bg-foreground' : i === step ? 'bg-foreground/35' : 'bg-border'
          }`}
        />
      ))}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-foreground mb-1">{label}</label>
      {hint && <p className="text-xs text-muted-foreground mb-2 leading-relaxed">{hint}</p>}
      {children}
    </div>
  );
}

const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function TextInput(props, ref) {
    return (
      <input
        ref={ref}
        {...props}
        className={`w-full px-3 py-2.5 border border-border rounded-md bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${props.className ?? ''}`}
      />
    );
  }
);

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { highlight?: boolean }) {
  const { highlight, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={`w-full px-3 py-2.5 border rounded-md bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors resize-none leading-relaxed ${
        highlight ? 'border-amber-400 ring-1 ring-amber-400/30' : 'border-border'
      }`}
    />
  );
}

function HandleInput({
  handles,
  suggestions,
  onAdd,
  onRemove,
}: {
  handles: string[];
  suggestions: string[];
  onAdd: (h: string) => void;
  onRemove: (h: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const MAX = 5;

  function commit() {
    const clean = draft.replace(/^@/, '').trim().toLowerCase();
    if (!clean || handles.includes(clean) || handles.length >= MAX) return;
    onAdd(clean);
    setDraft('');
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Backspace' && draft === '' && handles.length > 0) {
      onRemove(handles[handles.length - 1]);
    }
  }

  const available = suggestions.filter(s => !handles.includes(s.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground select-none">@</span>
          <TextInput
            ref={inputRef}
            className="pl-7"
            placeholder="handle"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKey}
            disabled={handles.length >= MAX}
          />
        </div>
        <button
          onClick={commit}
          disabled={!draft.trim() || handles.length >= MAX}
          className="px-3 py-2.5 border border-border rounded-md text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors disabled:opacity-40 flex items-center gap-1"
        >
          <Plus size={14} /> Add
        </button>
      </div>

      {handles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {handles.map(h => (
            <span
              key={h}
              className="flex items-center gap-1 text-xs bg-foreground text-background pl-2.5 pr-1.5 py-1 rounded-full"
            >
              @{h}
              <button onClick={() => onRemove(h)} className="hover:opacity-70 transition-opacity">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {available.length > 0 && handles.length < MAX && (
        <div>
          <p className="text-[10px] text-muted-foreground mb-1.5">Quick add</p>
          <div className="flex flex-wrap gap-1.5">
            {available.map(s => (
              <button
                key={s}
                onClick={() => onAdd(s.toLowerCase())}
                className="text-xs border border-border rounded-full px-2.5 py-1 text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors"
              >
                @{s}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        {handles.length}/{MAX} added. Press Enter or click Add.
      </p>
    </div>
  );
}

// ─── Code gate ─────────────────────────────────────────────────────────────────

function CodeGate({ onAccepted }: { onAccepted: () => void }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function redeem() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/invite/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = await res.json() as { error?: string; planTier?: string };
      if (!res.ok) throw new Error(data.error ?? 'Invalid code');
      onAccepted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Enter your invite code</h1>
        <p className="text-sm text-muted-foreground">
          Lore is invite-only right now. Enter your code to get started.
        </p>
      </div>
      <div className="space-y-3">
        <input
          autoFocus
          type="text"
          placeholder="e.g. BETA-XXXX"
          value={code}
          onChange={e => { setCode(e.target.value.toUpperCase()); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && redeem()}
          className="w-full px-3 py-2.5 border border-border rounded-md bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors font-mono tracking-wider"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button
          onClick={redeem}
          disabled={loading || !code.trim()}
          className="w-full flex items-center justify-center gap-2 text-sm px-5 py-2.5 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity disabled:opacity-35"
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          {loading ? 'Checking...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

// ─── Main wizard ───────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const isNewBrand = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('newBrand') === 'true';
  const [codeAccepted, setCodeAccepted] = useState(false);
  const [checkingPlan, setCheckingPlan] = useState(true);
  const [hasBrand, setHasBrand] = useState(false);
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [method, setMethod] = useState<'picker' | 'upload' | 'interview' | 'wizard'>('picker');
  const [interviewName, setInterviewName] = useState('');
  const [interviewHandle, setInterviewHandle] = useState('');

  // Skip code gate if paid; skip wizard if brand already exists (jump to interview step).
  // Also carries the handle typed on the landing page's hero, so nobody types it twice.
  useEffect(() => {
    Promise.resolve()
      .then(() => {
        const pending = window.localStorage.getItem('lore:pending-handle');
        if (!pending) return;
        window.localStorage.removeItem('lore:pending-handle');
        setInterviewHandle(prev => prev || pending);
        setState(prev => (prev.twitterHandle ? prev : { ...prev, twitterHandle: pending }));
      })
      .catch(() => {});

    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        if (data.planTier && data.planTier !== 'free') setCodeAccepted(true);
        if (data.brandId && !isNewBrand) { setHasBrand(true); setStep(TOTAL - 1); setMethod('wizard'); }
      })
      .catch(() => {})
      .finally(() => setCheckingPlan(false));
  }, []);

  // Interview-first path: minimal capture, create brand with placeholders, jump to interview.
  async function handleInterviewStart() {
    const name = interviewName.trim();
    if (!name || name.length < 2) {
      setError('Tell me your name or brand name to get started.');
      return;
    }
    const handle = interviewHandle.trim().replace(/^@/, '');

    setSubmitting(true);
    setError('');
    try {
      const brandRes = await fetch('/api/brands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          twitterHandle: handle || undefined,
          whatYouDo: 'Will be learned from the voice interview.',
          recentWin: 'Will be learned from the voice interview.',
          strongBelief: 'Will be learned from the voice interview.',
          platform: 'both',
          contentStyle: 'mixed',
          vibe: '',
          inspirationHandles: [],
          // If we have a handle, await profile + top-10 tweets sync so Q1-Q9
          // can reference real content. ~2-3s extra on the loading button.
          awaitQuickProfile: !!handle,
        }),
      });
      if (!brandRes.ok) {
        const data = await brandRes.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'Failed to create brand');
      }

      const interviewRes = await fetch('/api/interviews/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isOnboarding: true }),
      });
      if (interviewRes.ok) {
        const interviewData = await interviewRes.json() as { shareToken?: string; questionsQueue?: string[] };
        if (interviewData.shareToken) {
          if (interviewData.questionsQueue?.length) {
            const { prefetchTTSIntoCache } = await import('@/lib/tts-prefetch-cache');
            await Promise.allSettled(
              interviewData.questionsQueue.slice(0, 2).map(q => prefetchTTSIntoCache(q, interviewData.shareToken!))
            );
          }
          router.push(`/interview/${interviewData.shareToken}?onboarding=true`);
          return;
        }
      }
      const errData = await interviewRes.json().catch(() => ({})) as { error?: string; type?: string };
      throw new Error(errData.error ?? 'Could not start interview. Try again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  // Markdown upload state
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Copy-prompt state
  const [copied, setCopied] = useState(false);

  function copyAgentPrompt() {
    navigator.clipboard.writeText(AGENT_PROMPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  function set<K extends keyof WizardState>(k: K, v: WizardState[K]) {
    setState(prev => ({ ...prev, [k]: v }));
  }

  function addHandle(h: string) {
    if (state.inspirationHandles.includes(h) || state.inspirationHandles.length >= 5) return;
    set('inspirationHandles', [...state.inspirationHandles, h]);
  }

  function removeHandle(h: string) {
    set('inspirationHandles', state.inspirationHandles.filter(x => x !== h));
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setParseError('');
    setMissingFields([]);

    try {
      const text = await file.text();
      const res = await fetch('/api/onboarding/parse-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to parse');

      // Apply extracted fields, only overwrite if we got something
      setState(prev => ({
        ...prev,
        name:               data.name               ?? prev.name,
        twitterHandle:      data.twitterHandle      ?? prev.twitterHandle,
        linkedinHandle:     data.linkedinHandle     ?? prev.linkedinHandle,
        whatYouDo:          data.whatYouDo          ?? prev.whatYouDo,
        audience:           data.audience           ?? prev.audience,
        positioning:        data.positioning        ?? prev.positioning,
        backgroundSummary:  data.backgroundSummary  ?? prev.backgroundSummary,
        recentWin:          data.recentWin          ?? prev.recentWin,
        strongBelief:       data.strongBelief       ?? prev.strongBelief,
        expertise:          data.expertise          ?? prev.expertise,
        credibilityMarkers: data.credibilityMarkers ?? prev.credibilityMarkers,
        writingTone:        data.writingTone        ?? prev.writingTone,
        contentThemes:      data.contentThemes      ?? prev.contentThemes,
      }));

      if (data.missingFields?.length > 0) {
        setMissingFields(data.missingFields);
      }
      // If user came from the picker upload path, jump to confirmation
      if (method === 'upload') {
        setMethod('wizard');
        setStep(TOTAL - 1);
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Could not read file');
    } finally {
      setParsing(false);
      // Reset file input so same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function canAdvance() {
    if (step === 0) return state.name.trim().length > 0 && state.whatYouDo.trim().length > 10;
    if (step === 1) return state.audience.trim().length > 15;
    if (step === 2) return state.recentWin.trim().length > 20 && state.strongBelief.trim().length > 20;
    if (step === 3) return state.vibe !== '';
    return true;
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    try {
      if (!hasBrand) {
        const brandRes = await fetch('/api/brands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...state,
            handle: state.twitterHandle || state.linkedinHandle || undefined,
            whatYouDo: state.whatYouDo.slice(0, 2000),
            recentWin: state.recentWin.slice(0, 4000),
            strongBelief: state.strongBelief.slice(0, 4000),
            audience: state.audience ? state.audience.slice(0, 2000) : undefined,
            backgroundSummary: ([state.positioning, state.backgroundSummary].filter(Boolean).join('\n\n') || undefined)?.slice(0, 4000),
          }),
        });
        if (!brandRes.ok) {
          const data = await brandRes.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error ?? 'Failed to create brand');
        }
      }

      // Start the first interview session, this IS the voice setup
      const interviewRes = await fetch('/api/interviews/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isOnboarding: true }),
      });
      if (interviewRes.ok) {
        const interviewData = await interviewRes.json() as { shareToken?: string; questionsQueue?: string[] };
        if (interviewData.shareToken) {
          // Pre-fetch Q1 + Q2 audio before navigating so the interview page plays immediately
          if (interviewData.questionsQueue?.length) {
            const { prefetchTTSIntoCache } = await import('@/lib/tts-prefetch-cache');
            await Promise.allSettled(
              interviewData.questionsQueue.slice(0, 2).map(q => prefetchTTSIntoCache(q, interviewData.shareToken!))
            );
          }
          router.push(`/interview/${interviewData.shareToken}?onboarding=true`);
          return;
        }
      }
      const errData = await interviewRes.json().catch(() => ({})) as { error?: string; type?: string };
      if (interviewRes.status === 402) {
        throw new Error(
          errData.type === 'insufficient_credits'
            ? 'Out of credits. Top up to continue.'
            : 'Your plan does not include interviews. Upgrade to continue.'
        );
      }
      throw new Error(errData.error ?? 'Could not start interview. Try again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  const vibeLabel = VIBES.find(v => v.id === state.vibe)?.label ?? '';
  const suggestions = state.vibe ? (VIBE_SUGGESTIONS[state.vibe] ?? []) : [];

  const MISSING_LABELS: Record<string, string> = {
    name:          'Your name',
    whatYouDo:     'What you do',
    audience:      'Your target audience',
    recentWin:     'A recent win',
    strongBelief:  'A strong belief',
  };

  if (checkingPlan) return null;

  if (!codeAccepted) {
    return <CodeGate onAccepted={() => setCodeAccepted(true)} />;
  }

  // ── Chat-led onboarding (default for fresh onboarding) ──────────────────
  // The classic wizard stays available at ?mode=classic.
  const isClassicMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'classic';
  if (!isClassicMode && !isNewBrand && method === 'picker' && !hasBrand) {
    return <ChatOnboarding />;
  }

  // ── Method picker (screen -1), only shows for fresh onboarding ─────────
  if (method === 'picker' && !hasBrand) {
    return (
      <div className="w-full max-w-2xl">
        <div className="mb-10 text-center">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Step 1 of 2 · Setup</span>
          <h1 className="text-3xl font-semibold tracking-tight mt-3">Let&apos;s teach Lore your voice</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto leading-relaxed">
            Two ways to set up your brand. Pick whichever feels faster. You can always tweak everything later.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Option 1: Upload a file you got from ChatGPT/Claude */}
          <button
            onClick={() => setMethod('upload')}
            className="group relative bg-card border border-border rounded-xl p-6 text-left hover:border-muted-foreground/40 transition-colors"
          >
            <div className="flex items-center gap-2 mb-3">
              <FileText size={16} className="text-foreground/70" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Already on ChatGPT?</span>
            </div>
            <p className="text-base font-semibold text-foreground mb-1">Copy a prompt → upload a file</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              We give you a prompt to paste into ChatGPT or Claude. Save its answer, upload here, done.
            </p>
          </button>

          {/* Option 2: Voice interview, talk to Lore directly */}
          <button
            onClick={() => setMethod('interview')}
            className="group relative bg-card border-2 border-foreground/30 rounded-xl p-6 text-left hover:border-foreground transition-colors"
          >
            <div className="flex items-center gap-2 mb-3">
              <Mic2 size={16} className="text-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground/60">Recommended</span>
            </div>
            <p className="text-base font-semibold text-foreground mb-1">Talk to Lore for 10 minutes</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              An AI-led voice interview. Just answer the questions out loud. Lore pulls everything it needs from your answers.
            </p>
          </button>
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={() => setMethod('wizard')}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Or fill out the form yourself →
          </button>
        </div>
      </div>
    );
  }

  // ── Upload screen: focused drop zone ───────────────────────────────────
  if (method === 'upload' && !hasBrand) {
    return (
      <div className="w-full max-w-lg">
        <button
          onClick={() => setMethod('picker')}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-6"
        >
          <ChevronLeft size={12} /> Back
        </button>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Upload a file about you</h1>
          <p className="text-sm text-muted-foreground">
            Markdown, text, or anything you have. We&apos;ll extract what we need.
          </p>
        </div>

        <div className="border border-border rounded-lg p-5 bg-muted/30 mb-4">
          <div className="flex items-start gap-3 mb-3">
            <Bot size={15} className="text-foreground/70 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Don&apos;t have one ready?</p>
              <p className="text-xs text-muted-foreground mt-0.5">Copy this prompt into ChatGPT or Claude. Upload its response back here.</p>
            </div>
          </div>
          <button
            onClick={copyAgentPrompt}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-foreground text-background hover:opacity-90 transition-opacity"
          >
            {copied ? <CheckCheck size={11} /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy prompt'}
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt,.json"
          className="hidden"
          onChange={handleFileUpload}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={parsing}
          className="w-full border-2 border-dashed border-border rounded-lg py-12 hover:border-foreground/40 transition-colors flex flex-col items-center gap-2 disabled:opacity-50"
        >
          {parsing ? (
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          ) : (
            <Upload size={20} className="text-muted-foreground" />
          )}
          <span className="text-sm font-medium text-foreground">
            {parsing ? 'Reading file...' : 'Click to upload'}
          </span>
          <span className="text-xs text-muted-foreground">.md, .txt, or .json</span>
        </button>

        {parseError && (
          <div className="mt-3 flex items-start gap-2 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2.5">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            {parseError}
          </div>
        )}
      </div>
    );
  }

  // ── Interview-first screen: minimal capture then launch interview ──────
  if (method === 'interview' && !hasBrand) {
    return (
      <div className="w-full max-w-lg">
        <button
          onClick={() => setMethod('picker')}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-6"
        >
          <ChevronLeft size={12} /> Back
        </button>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Two things, then we talk.</h1>
          <p className="text-sm text-muted-foreground">
            Lore needs your name and one social handle to get going. The interview will pull the rest from your answers.
          </p>
        </div>

        <div className="space-y-4">
          <Field label="Your name or brand name">
            <TextInput
              autoFocus
              placeholder="e.g. Maya Chen"
              value={interviewName}
              onChange={e => setInterviewName(e.target.value)}
            />
          </Field>

          <Field
            label="X / Twitter handle"
            hint="Optional. Lore uses this to pull your existing posts so it can learn from what's already working."
          >
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground select-none">@</span>
              <TextInput
                placeholder="yourhandle"
                className="pl-7"
                value={interviewHandle}
                onChange={e => setInterviewHandle(e.target.value)}
              />
            </div>
          </Field>
        </div>

        <button
          onClick={handleInterviewStart}
          disabled={interviewName.trim().length < 2 || submitting}
          className="mt-6 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-foreground text-background rounded-md font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {submitting ? <Loader2 size={13} className="animate-spin" /> : <Mic2 size={13} />}
          {submitting ? 'Starting the interview…' : 'Start the interview'}
        </button>

        {error && (
          <div className="mt-3 flex items-start gap-2 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2.5">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg">
      {step === 0 && !hasBrand && (
        <button
          onClick={() => setMethod('picker')}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4"
        >
          <ChevronLeft size={12} /> Back to setup choices
        </button>
      )}
      <Progress step={step} />

      {/* ── Step 0: Basics ───────────────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">Set up your brand</h1>
            <p className="text-sm text-muted-foreground">A few quick questions. No content experience needed.</p>
          </div>

          {/* ── AI agent shortcut ────────────────────────────────────────────── */}
          <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-md bg-foreground/8 border border-border flex items-center justify-center shrink-0">
                <Bot size={15} className="text-foreground/70" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground leading-tight">Already use Claude or ChatGPT?</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Copy this prompt, paste it into your AI agent, and upload the response. It fills everything in one shot.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={copyAgentPrompt}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md bg-foreground text-background hover:opacity-90 transition-opacity"
              >
                {copied ? <CheckCheck size={12} /> : <Copy size={12} />}
                {copied ? 'Copied!' : 'Copy prompt'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt"
                className="hidden"
                onChange={handleFileUpload}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={parsing}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border hover:border-muted-foreground/50 rounded-md px-3 py-2 transition-colors disabled:opacity-50"
              >
                {parsing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {parsing ? 'Reading...' : 'Upload response'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or fill in manually</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Parse error */}
          {parseError && (
            <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2.5">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              {parseError}
            </div>
          )}

          {/* Missing fields notice */}
          {missingFields.length > 0 && (
            <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-md px-3 py-2.5 leading-relaxed">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              <span>
                We filled in what we found. Still need:{' '}
                <strong>{missingFields.map(f => MISSING_LABELS[f] ?? f).join(', ')}</strong>.
              </span>
            </div>
          )}

          <Field label="Your name or brand name">
            <TextInput
              autoFocus
              placeholder="e.g. Maya Chen"
              value={state.name}
              onChange={e => set('name', e.target.value)}
            />
          </Field>

          <Field
            label="What do you do, and who do you help?"
            hint="Write it how you'd explain it to someone at a dinner party. No jargon needed."
          >
            <Textarea
              rows={3}
              placeholder="e.g. I help early-stage founders raise their first round. I've been in VC for 8 years and now I advise 6 companies."
              value={state.whatYouDo}
              highlight={missingFields.includes('whatYouDo') && !state.whatYouDo}
              onChange={e => {
                set('whatYouDo', e.target.value);
                setMissingFields(prev => prev.filter(f => f !== 'whatYouDo'));
              }}
            />
          </Field>

          <Field label="Where do you want to publish?">
            <div className="flex gap-2">
              {PLATFORMS.map(p => (
                <button
                  key={p.id}
                  onClick={() => set('platform', p.id)}
                  className={`flex-1 py-2.5 rounded-md border text-sm font-medium transition-colors ${
                    state.platform === p.id
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-foreground hover:border-muted-foreground/50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>

          {(state.platform === 'twitter' || state.platform === 'both') && (
            <Field
              label="X / Twitter handle"
              hint="Optional. Lore uses this to pull your posts and calibrate faster."
            >
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground select-none">@</span>
                <TextInput
                  placeholder="yourhandle"
                  className="pl-7"
                  value={state.twitterHandle}
                  onChange={e => set('twitterHandle', e.target.value)}
                />
              </div>
            </Field>
          )}

          {(state.platform === 'linkedin' || state.platform === 'both') && (
            <Field
              label="LinkedIn profile URL"
              hint="Optional. Paste your full LinkedIn URL or just the slug at the end."
            >
              <div className="flex items-center border border-border rounded-md bg-card overflow-hidden focus-within:ring-2 focus-within:ring-ring">
                <span className="px-3 py-2.5 text-xs text-muted-foreground bg-muted border-r border-border shrink-0 select-none">
                  linkedin.com/in/
                </span>
                <input
                  type="text"
                  placeholder="your-name"
                  value={state.linkedinHandle.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\/?/, '').replace(/\/$/, '')}
                  onChange={e => set('linkedinHandle', e.target.value.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\/?/, '').replace(/\/$/, ''))}
                  className="flex-1 px-3 py-2.5 text-sm text-foreground bg-transparent placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
            </Field>
          )}
        </div>
      )}

      {/* ── Step 1: Audience & Positioning ───────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">Who are you writing for?</h1>
            <p className="text-sm text-muted-foreground">
              This context shapes every post Lore generates. Be specific: &quot;founders&quot; is fine, &quot;first-time B2B founders pre-product-market-fit&quot; is better.
            </p>
          </div>

          <Field
            label="Who is your target audience?"
            hint="Describe your ideal reader. Include their role, stage, and main problem if possible."
          >
            <Textarea
              autoFocus
              rows={3}
              placeholder="e.g. Early-stage SaaS founders trying to get their first 100 customers. They've built the product but don't know how to sell it."
              value={state.audience}
              onChange={e => {
                set('audience', e.target.value);
                setMissingFields(prev => prev.filter(f => f !== 'audience'));
              }}
            />
          </Field>

          <Field
            label="What's your unique angle?"
            hint="What do you see that others in your space miss? Your contrarian point of view."
          >
            <Textarea
              rows={3}
              placeholder="e.g. I focus on distribution before product. Most founders build too much before talking to real customers. I help them flip that order."
              value={state.positioning}
              onChange={e => set('positioning', e.target.value)}
            />
          </Field>

          <Field
            label="Key background or credentials"
            hint="Optional. 1-3 things that make you credible here. Doesn't need to be formal."
          >
            <Textarea
              rows={2}
              placeholder="e.g. 8 years in VC, advised 20+ startups. Previously built and sold a B2B SaaS company."
              value={state.backgroundSummary}
              onChange={e => set('backgroundSummary', e.target.value)}
            />
          </Field>
        </div>
      )}

      {/* ── Step 2: Two quick stories ─────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">Two quick things</h1>
            <p className="text-sm text-muted-foreground">
              These help Lore understand how you think and talk. Write them like you&apos;re texting a colleague.
            </p>
          </div>

          <Field
            label="Describe a recent win"
            hint="Could be anything: a deal closed, a system that worked, something a client said. 2-4 sentences is enough."
          >
            <Textarea
              autoFocus
              rows={4}
              placeholder="e.g. One of my portfolio founders just closed their seed round in 3 weeks. 6 months ago they couldn't explain what they did in under a minute. We just worked on the story, nothing else."
              value={state.recentWin}
              highlight={missingFields.includes('recentWin') && !state.recentWin}
              onChange={e => {
                set('recentWin', e.target.value);
                setMissingFields(prev => prev.filter(f => f !== 'recentWin'));
              }}
            />
          </Field>

          <Field
            label="What's something you strongly believe about your field that most people get wrong?"
            hint="No need to be diplomatic. The more specific the better."
          >
            <Textarea
              rows={4}
              placeholder="e.g. Most founders think their pitch deck is the problem. It's almost never the deck. It's that they can't explain why they specifically are the right person to build this."
              value={state.strongBelief}
              highlight={missingFields.includes('strongBelief') && !state.strongBelief}
              onChange={e => {
                set('strongBelief', e.target.value);
                setMissingFields(prev => prev.filter(f => f !== 'strongBelief'));
              }}
            />
          </Field>

          {missingFields.some(f => ['recentWin', 'strongBelief'].includes(f)) && (
            <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-md px-3 py-2.5 leading-relaxed">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              Your profile didn&apos;t have enough detail for the highlighted fields. Fill them in so Lore can calibrate your voice.
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Vibe quiz ─────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">Which feels most like you?</h1>
            <p className="text-sm text-muted-foreground">
              Pick the style that feels closest. You&apos;re not locked in. Lore adjusts as you go.
            </p>
          </div>

          <div className="space-y-3">
            {VIBES.map(v => (
              <button
                key={v.id}
                onClick={() => set('vibe', v.id as VibeId)}
                className={`w-full text-left rounded-md border transition-all p-0 overflow-hidden ${
                  state.vibe === v.id
                    ? 'border-foreground ring-1 ring-foreground'
                    : 'border-border hover:border-muted-foreground/50'
                }`}
              >
                <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${
                  state.vibe === v.id ? 'border-foreground/20 bg-foreground/5' : 'border-border bg-muted/30'
                }`}>
                  <div className={`w-3 h-3 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    state.vibe === v.id ? 'border-foreground bg-foreground' : 'border-border'
                  }`}>
                    {state.vibe === v.id && <div className="w-1 h-1 rounded-full bg-background" />}
                  </div>
                  <span className="text-xs font-semibold text-foreground">{v.label}</span>
                  <span className="text-xs text-muted-foreground ml-1">{v.cue}</span>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{v.post}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 4: Content style ─────────────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">How do you want to come across?</h1>
            <p className="text-sm text-muted-foreground">
              This shapes how Lore approaches every post it writes for you.
            </p>
          </div>

          <div className="space-y-3">
            {CONTENT_STYLES.map(s => (
              <button
                key={s.id}
                onClick={() => set('contentStyle', s.id)}
                className={`w-full text-left rounded-md border transition-all p-0 overflow-hidden ${
                  state.contentStyle === s.id
                    ? 'border-foreground ring-1 ring-foreground'
                    : 'border-border hover:border-muted-foreground/50'
                }`}
              >
                <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${
                  state.contentStyle === s.id ? 'border-foreground/20 bg-foreground/5' : 'border-border bg-muted/30'
                }`}>
                  <div className={`w-3 h-3 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    state.contentStyle === s.id ? 'border-foreground bg-foreground' : 'border-border'
                  }`}>
                    {state.contentStyle === s.id && <div className="w-1 h-1 rounded-full bg-background" />}
                  </div>
                  <span className="text-xs font-semibold text-foreground">{s.label}</span>
                  <span className="text-xs text-muted-foreground ml-1">{s.cue}</span>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{s.post}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 5: Inspiration handles ───────────────────────────────────── */}
      {step === 5 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">Who do you enjoy reading?</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Add 1-5 people whose posts you actually like. Could be how they phrase things, how they tell stories, how they structure ideas.
            </p>
            <p className="text-xs text-muted-foreground mt-2 bg-muted/60 rounded-md px-3 py-2 leading-relaxed">
              Doesn&apos;t have to be in your niche. Lore studies their phrasing and sentence rhythm, not their topics. Someone whose writing clicks with you tells us more than any dropdown ever could.
            </p>
          </div>

          <HandleInput
            handles={state.inspirationHandles}
            suggestions={suggestions}
            onAdd={addHandle}
            onRemove={removeHandle}
          />
        </div>
      )}

      {/* ── Step 6: Confirmation ──────────────────────────────────────────── */}
      {step === 6 && (
        <div className="space-y-6">
          <div className="flex justify-center">
            <div className="w-14 h-14 rounded-full bg-foreground flex items-center justify-center">
              <Check size={22} className="text-background" />
            </div>
          </div>

          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight mb-2">One more thing</h1>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Lore learns your voice through a short AI interview. Answer a few questions out loud or by typing. It takes about 5 minutes and builds your voice profile.
            </p>
          </div>

          <div className="bg-card border border-border rounded-md divide-y divide-border">
            <div className="px-4 py-3.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Brand</p>
              <p className="text-sm font-medium text-foreground">{state.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">{state.whatYouDo}</p>
            </div>

            {state.audience && (
              <div className="px-4 py-3.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Target Audience</p>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{state.audience}</p>
              </div>
            )}

            {state.positioning && (
              <div className="px-4 py-3.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Unique Angle</p>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{state.positioning}</p>
              </div>
            )}

            <div className="px-4 py-3.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Platform</p>
              <p className="text-sm text-foreground">
                {state.platform === 'twitter' ? 'X / Twitter' : state.platform === 'linkedin' ? 'LinkedIn' : 'X + LinkedIn'}
              </p>
              {state.platform === 'both' && (state.twitterHandle || state.linkedinHandle) && (
                <div className="flex gap-3 mt-1">
                  {state.twitterHandle && <span className="text-xs text-muted-foreground">X: @{state.twitterHandle}</span>}
                  {state.linkedinHandle && <span className="text-xs text-muted-foreground">LI: @{state.linkedinHandle}</span>}
                </div>
              )}
              {state.platform !== 'both' && (state.twitterHandle || state.linkedinHandle) && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  @{state.platform === 'twitter' ? state.twitterHandle : state.linkedinHandle}
                </p>
              )}
            </div>

            <div className="px-4 py-3.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Writing style</p>
              <p className="text-sm text-foreground">{vibeLabel}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Calibrated from your win, your belief
                {state.inspirationHandles.length > 0
                  ? `, and ${state.inspirationHandles.length} inspiration profile${state.inspirationHandles.length > 1 ? 's' : ''}`
                  : ''}.
              </p>
            </div>

            {state.expertise?.length ? (
              <div className="px-4 py-3.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Expertise</p>
                <div className="flex flex-wrap gap-1.5">
                  {state.expertise.map(e => (
                    <span key={e} className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{e}</span>
                  ))}
                </div>
              </div>
            ) : null}

            {state.contentThemes?.length ? (
              <div className="px-4 py-3.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Content themes</p>
                <div className="flex flex-wrap gap-1.5">
                  {state.contentThemes.map(t => (
                    <span key={t} className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{t}</span>
                  ))}
                </div>
              </div>
            ) : null}

            {state.credibilityMarkers?.length ? (
              <div className="px-4 py-3.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Credibility</p>
                <ul className="space-y-1">
                  {state.credibilityMarkers.map(c => (
                    <li key={c} className="text-xs text-muted-foreground flex gap-2">
                      <span className="text-border mt-0.5">-</span>{c}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {state.inspirationHandles.length > 0 && (
              <div className="px-4 py-3.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Style references</p>
                <div className="flex flex-wrap gap-1.5">
                  {state.inspirationHandles.map(h => (
                    <span key={h} className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">@{h}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="px-4 py-3.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">What&apos;s next</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                A 5-minute AI interview. Lore asks you questions. You answer by voice or by typing. It extracts your stories, opinions, and patterns, then uses them to write in your voice.
              </p>
            </div>
          </div>

          {error && <p className="text-sm text-destructive text-center">{error}</p>}
        </div>
      )}

      {/* ── Navigation ────────────────────────────────────────────────────── */}
      <div className={`mt-8 flex ${step === 0 ? 'justify-end' : 'justify-between'} items-center`}>
        {step > 0 && (
          <button
            onClick={() => setStep(s => s - 1)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft size={16} />
            Back
          </button>
        )}

        {step < 6 ? (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={!canAdvance()}
            className="flex items-center gap-2 text-sm px-5 py-2.5 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity disabled:opacity-35"
          >
            {step === 1 && !state.positioning && !state.backgroundSummary
              ? 'Continue'
              : step === 5 && state.inspirationHandles.length === 0
              ? 'Skip'
              : 'Continue'}
            <ChevronRight size={15} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 text-sm px-5 py-2.5 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity disabled:opacity-70"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? 'Setting up...' : 'Start voice interview'}
            {!submitting && <ChevronRight size={15} />}
          </button>
        )}
      </div>
    </div>
  );
}
