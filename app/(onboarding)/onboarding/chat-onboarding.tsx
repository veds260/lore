'use client';

// Chat-led onboarding: the checklist on the left injects scripted user
// messages into a conversation with Lore, and the conversation IS the
// onboarding. Steps strike through as they complete. The classic wizard
// stays available at ?mode=classic.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, Loader2, Send } from 'lucide-react';

type StepId = 'meet' | 'connect_x' | 'audit' | 'style' | 'telegram';

const STEPS: Array<{ id: StepId; label: string; scripted: string }> = [
  { id: 'meet',      label: 'Meet Lore',                scripted: 'hey, what exactly are you?' },
  { id: 'connect_x', label: 'Connect your X',           scripted: "let's connect my X so you can learn my voice." },
  { id: 'audit',     label: 'Hear the audit',           scripted: 'take a look at my posts and tell me what you see.' },
  { id: 'style',     label: 'Pick your style',          scripted: 'how should my posts feel?' },
  { id: 'telegram',  label: 'Take Lore with you',       scripted: 'can you message me outside this app?' },
];

const MEET_REPLY = `i'm Lore, your head of content.

here's how this works: i learn your voice from your real posts, not from a questionnaire. you draft with me, and every edit you make teaches me a rule i apply forever. i watch how your posts perform against your own averages and tell you what's working.

first step: connect your X so i can read your last posts. tap "Connect your X" on the left when you're ready.`;

const STYLE_OPTIONS = [
  { id: 'witty-short', label: 'Witty and short' },
  { id: 'deep-value',  label: 'Deep and valuable' },
  { id: 'mixed',       label: 'Mix of both' },
];

interface Msg {
  role: 'user' | 'assistant';
  text: string;
}

export function ChatOnboarding() {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [completed, setCompleted] = useState<Set<StepId>>(new Set());
  const [busyStep, setBusyStep] = useState<StepId | null>(null);
  const [typing, setTyping] = useState(false);

  // connect_x inline form
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [connectError, setConnectError] = useState('');

  // style quick replies
  const [showStyleButtons, setShowStyleButtons] = useState(false);

  // telegram
  const [telegramUrl, setTelegramUrl] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing, showConnectForm, showStyleButtons, telegramUrl]);

  function push(msg: Msg) {
    setMessages(prev => [...prev, msg]);
  }

  function complete(step: StepId) {
    setCompleted(prev => new Set(prev).add(step));
  }

  async function assistantSays(text: string) {
    setTyping(true);
    await new Promise(r => setTimeout(r, 600));
    setTyping(false);
    push({ role: 'assistant', text });
  }

  async function runStep(step: StepId) {
    if (busyStep || completed.has(step)) return;
    const def = STEPS.find(s => s.id === step)!;
    setBusyStep(step);
    push({ role: 'user', text: def.scripted });

    try {
      if (step === 'meet') {
        await assistantSays(MEET_REPLY);
        complete('meet');
      }

      if (step === 'connect_x') {
        await assistantSays("good. drop your name and your X handle below and i'll pull your recent posts. takes a few seconds.");
        setShowConnectForm(true);
        // completes in handleConnect
      }

      if (step === 'audit') {
        setTyping(true);
        const res = await fetch('/api/onboarding/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step: 'audit' }),
        });
        const json = await res.json();
        setTyping(false);
        if (json.message) {
          push({ role: 'assistant', text: json.message });
          complete('audit');
          setShowStyleButtons(true);
          complete('style'); // the audit ends on the style question; buttons answer it
        } else if (json.reason === 'no-posts') {
          push({ role: 'assistant', text: "i don't see any posts on that account yet, so there's nothing to audit. no problem. we'll build your baseline from what you write with me. pick a style below and we keep moving." });
          complete('audit');
          setShowStyleButtons(true);
          complete('style');
        } else {
          push({ role: 'assistant', text: 'connect your X first, then ask me again.' });
        }
      }

      if (step === 'style') {
        await assistantSays('three ways i can lean. pick the one that sounds like you.');
        setShowStyleButtons(true);
      }

      if (step === 'telegram') {
        const res = await fetch('/api/telegram/link', { method: 'POST' });
        const json = await res.json().catch(() => ({}));
        if (json.url) {
          setTelegramUrl(json.url);
          await assistantSays("yes. link Telegram and i'll send you a morning brief (how your last post pulled, what's on the board, fresh ideas) and an evening report when something ships. tap the button below, then hit Start in Telegram.");
        } else {
          await assistantSays('telegram linking is not available right now. you can set it up later from settings. you are good to go, the board is ready.');
          complete('telegram');
        }
      }
    } finally {
      setBusyStep(null);
    }
  }

  async function handleConnect() {
    const cleanName = name.trim();
    const cleanHandle = handle.trim().replace(/^@/, '');
    if (cleanName.length < 2) {
      setConnectError('your name first, then we go.');
      return;
    }
    setConnectError('');
    setBusyStep('connect_x');
    setTyping(true);
    try {
      const res = await fetch('/api/brands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          twitterHandle: cleanHandle || undefined,
          whatYouDo: 'Will be learned from real posts.',
          recentWin: 'Will be learned from real posts.',
          strongBelief: 'Will be learned from real posts.',
          platform: 'both',
          contentStyle: 'mixed',
          vibe: '',
          inspirationHandles: [],
          awaitQuickProfile: !!cleanHandle,
        }),
      });
      setTyping(false);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setConnectError((data as { error?: string }).error ?? 'could not connect. try again.');
        return;
      }
      setShowConnectForm(false);
      complete('connect_x');
      if (cleanHandle) {
        push({ role: 'assistant', text: `connected as @${cleanHandle}. i pulled your recent posts. ask me for the audit, or tap "Hear the audit" on the left.` });
      } else {
        push({ role: 'assistant', text: `set up as ${cleanName}. no handle yet, so i have no posts to read. you can add one later in your profile. pick your style next.` });
        complete('audit');
        setShowStyleButtons(true);
      }
    } catch {
      setTyping(false);
      setConnectError('could not connect. try again.');
    } finally {
      setBusyStep(null);
    }
  }

  async function handleStylePick(styleId: string, label: string) {
    setShowStyleButtons(false);
    push({ role: 'user', text: label.toLowerCase() });
    await fetch('/api/brands/content-style', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentStyle: styleId }),
    }).catch(() => {});
    complete('style');
    await assistantSays(`noted. ${label.toLowerCase()} it is. that shapes every draft from here, and your edits will keep tuning it. last thing: tap "Take Lore with you" so i can reach you outside this tab.`);
  }

  function handleTelegramDone() {
    complete('telegram');
    push({ role: 'assistant', text: "that's everything. your board is ready, and tomorrow morning you get your first brief. let's go." });
    setTimeout(() => router.push('/board'), 1800);
  }

  const allDone = completed.size === STEPS.length;

  return (
    <div className="w-full max-w-4xl mx-auto flex gap-6 h-[calc(100vh-8rem)]">
      {/* Checklist */}
      <div className="w-56 shrink-0 pt-2">
        <h1 className="text-lg font-semibold tracking-tight mb-1">Welcome to Lore</h1>
        <p className="text-xs text-muted-foreground mb-5 leading-relaxed">Work through these with Lore. Click a step to ask about it.</p>
        <div className="space-y-1">
          {STEPS.map(step => {
            const done = completed.has(step.id);
            const busy = busyStep === step.id;
            return (
              <button
                key={step.id}
                onClick={() => runStep(step.id)}
                disabled={busy || done}
                className={`w-full flex items-center gap-2 text-left text-sm px-2.5 py-2 rounded-md transition-colors ${
                  done ? 'text-muted-foreground line-through' : 'text-foreground hover:bg-accent'
                }`}
              >
                <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${done ? 'bg-[#529E63] border-[#529E63]' : 'border-border'}`}>
                  {done && <Check size={10} className="text-white" />}
                  {busy && <Loader2 size={10} className="animate-spin" />}
                </span>
                {step.label}
              </button>
            );
          })}
        </div>
        {allDone && (
          <button
            onClick={() => router.push('/board')}
            className="mt-5 w-full text-xs px-3 py-2 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity"
          >
            Open your board
          </button>
        )}
        <Link
          href="/onboarding?mode=classic"
          className="block mt-6 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Prefer guided steps instead
        </Link>
      </div>

      {/* Chat */}
      <div className="flex-1 flex flex-col border border-border rounded-xl bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold">Lore</p>
          <p className="text-[11px] text-muted-foreground">Head of Content, working for you</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center pt-10">
              Tap &quot;Meet Lore&quot; on the left to start.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] text-sm leading-relaxed whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 ${
                m.role === 'user'
                  ? 'bg-foreground text-background rounded-br-sm'
                  : 'bg-accent text-foreground rounded-bl-sm'
              }`}>
                {m.text}
              </div>
            </div>
          ))}
          {typing && (
            <div className="flex justify-start">
              <div className="bg-accent rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                <Loader2 size={14} className="animate-spin text-muted-foreground" />
              </div>
            </div>
          )}

          {showConnectForm && (
            <div className="border border-border rounded-xl p-3.5 space-y-2.5 bg-background/50">
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name or brand name"
                className="w-full text-sm bg-background border border-border rounded-md px-3 py-2"
              />
              <input
                value={handle}
                onChange={e => setHandle(e.target.value)}
                placeholder="@yourhandle (optional, but Lore learns faster with it)"
                className="w-full text-sm bg-background border border-border rounded-md px-3 py-2"
              />
              {connectError && <p className="text-[11px] text-destructive">{connectError}</p>}
              <button
                onClick={handleConnect}
                disabled={busyStep === 'connect_x'}
                className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {busyStep === 'connect_x' ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                Connect and pull my posts
              </button>
            </div>
          )}

          {showStyleButtons && (
            <div className="flex flex-wrap gap-2">
              {STYLE_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => handleStylePick(opt.id, opt.label)}
                  className="text-xs px-3 py-2 border border-border rounded-full hover:bg-accent transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {telegramUrl && !completed.has('telegram') && (
            <div className="space-y-2">
              <a
                href={telegramUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => setTimeout(handleTelegramDone, 1200)}
                className="inline-flex items-center gap-1.5 text-xs px-3.5 py-2 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity"
              >
                <Send size={11} /> Open Telegram and tap Start
              </a>
              <button
                onClick={handleTelegramDone}
                className="block text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip for now
              </button>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
