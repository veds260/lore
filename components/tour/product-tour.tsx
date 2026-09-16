'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { X, ArrowRight, Sparkles } from 'lucide-react';
import { resolveTooltipPosition, scrollTargetIntoView } from './position';

interface Step {
  target?: string;     // CSS selector with [data-tour="..."] or null for centered
  title: string;
  body: string;
  position?: 'right' | 'left' | 'top' | 'bottom';
}

const STEPS: Step[] = [
  {
    title: 'Lore writes for you.',
    body: 'Let me show you the fastest way to your first post. 60 seconds. Skip anytime with Esc.',
  },
  {
    target: '[data-tour="pulse"]',
    title: "Today's Pulse: your daily ideas",
    body: 'Every morning Lore pulls trending posts from your niche and turns them into ready-to-write ideas. Tap any Generate button to write your first post in seconds.',
    position: 'bottom',
  },
  {
    target: '[data-tour="new-post"]',
    title: 'Or write from scratch',
    body: 'Click here, type a topic, and Lore generates an X post + a LinkedIn post together, both in your voice.',
    position: 'left',
  },
  {
    target: '[data-tour="nav-ideas"]',
    title: 'Ideas from your voice',
    body: 'This page shows post ideas auto-generated from your interviews + trending topics in your niche. Tap "Generate post" on any to turn it into a draft.',
    position: 'right',
  },
  {
    target: '[data-tour="nav-chat"]',
    title: 'Chat for quick help',
    body: 'Talk to Lore directly when you want a fast brainstorm, a single rewrite, or just to ask "what should I post today?"',
    position: 'right',
  },
  {
    target: '[data-tour="nav-interviews"]',
    title: 'Sessions feed your Ideas',
    body: 'Talk to Lore for 10 minutes about what you\'re building, thinking, or struggling with. The system pulls 5-10 post ideas from every session.',
    position: 'right',
  },
  {
    target: '[data-tour="nav-profile"]',
    title: 'What Lore knows about you',
    body: 'Your bio, voice, content pillars, banned phrases: everything the AI uses to write like you. Edit anything anytime.',
    position: 'right',
  },
  {
    target: '[data-tour="nav-learning"]',
    title: 'Watch the system learn',
    body: 'Top posts, learned rules, hook patterns. The more you publish and revise, the sharper Lore gets.',
    position: 'right',
  },
  {
    target: '[data-tour="nav-settings"]',
    title: 'Capture ideas on the go: Telegram',
    body: 'Connect Lore to Telegram in Settings. Send a voice memo from a walk, drop a thought between meetings, or tap /draft to turn it into a full post. Everything lands here on your board.',
    position: 'right',
  },
  {
    title: "You're set. Open a post to see what's inside.",
    body: 'Tap any card to open the drawer. Inside you can Revise the AI\'s output, generate a matching Image, or apply a proven Format (viral templates from your library). Try generating your first post now.',
  },
];

type Rect = { top: number; left: number; width: number; height: number };

function getRect(selector: string): Rect | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function ProductTour() {
  const pathname = usePathname();
  const onBoard = pathname === '/board' || pathname?.startsWith('/board');
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  // Decide whether to auto-start on mount: check the server-side flag, not localStorage.
  // Only fires on /board because the steps target sidebar nav + pulse strip on that page;
  // firing it on /admin or any other route results in tooltips pointing at empty space.
  useEffect(() => {
    if (!onBoard) return;
    let cancelled = false;
    fetch('/api/tour/status')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        if (data?.mainCompleted) return;
        // Small delay so target elements are rendered
        setTimeout(() => { if (!cancelled) setActive(true); }, 600);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [onBoard]);

  // If the user navigates away from /board during the tour, dismiss without
  // persisting. They resume on the next /board visit instead of staring at
  // stale highlights.
  useEffect(() => {
    Promise.resolve()
      .then(() => {
        if (!onBoard && active) setActive(false);
      })
      .catch(() => {});
  }, [onBoard, active]);

  // Lock body scroll while tour is active
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active]);

  // Recompute target rect on step change + window resize.
  // Scrolls the target into view first so the tooltip never lands on an off-screen target.
  const updateRect = useCallback(async () => {
    const step = STEPS[stepIndex];
    if (!step?.target) { setRect(null); return; }
    await scrollTargetIntoView(step.target);
    const r = getRect(step.target);
    // Target missing or has zero size, skip this step rather than show a floating tooltip
    if (!r || r.width === 0 || r.height === 0) {
      if (stepIndex < STEPS.length - 1) {
        setStepIndex(i => i + 1);
      } else {
        finish();
      }
      return;
    }
    setRect(r);
  }, [stepIndex]);

  useEffect(() => {
    if (!active) return;
    Promise.resolve().then(() => updateRect());
    const onResize = () => updateRect();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [active, updateRect]);

  // Keyboard
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') skip();
      if (e.key === 'Enter') next();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex]);

  function next() {
    if (stepIndex >= STEPS.length - 1) {
      finish();
    } else {
      setStepIndex(i => i + 1);
    }
  }

  function skip() {
    finish();
  }

  function finish() {
    setActive(false);
    // Fire-and-forget, failure is non-fatal, user just sees tour next visit
    fetch('/api/tour/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'main' }),
    }).catch(() => {});
  }

  if (!active) return null;

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const isFirst = stepIndex === 0;
  const total = STEPS.length;

  // Tooltip position
  const tooltipWidth = 320;
  const tooltipMargin = 16;
  let tooltipStyle: React.CSSProperties = {};
  let highlightStyle: React.CSSProperties | null = null;

  if (rect) {
    // Highlight (glow ring around target)
    highlightStyle = {
      position: 'fixed',
      top: rect.top - 6,
      left: rect.left - 6,
      width: rect.width + 12,
      height: rect.height + 12,
      borderRadius: 12,
      boxShadow: '0 0 0 3px rgba(255,255,255,0.95), 0 0 0 6px rgba(82,158,99,0.4), 0 0 40px rgba(82,158,99,0.3)',
      pointerEvents: 'none',
      zIndex: 51,
      transition: 'all 0.2s ease',
    };

    if (typeof window !== 'undefined') {
      const resolved = resolveTooltipPosition({
        rect,
        preferred: step.position ?? 'right',
        tooltipWidth,
        margin: tooltipMargin,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
      tooltipStyle = resolved.style;
    }
  } else {
    // Centered tooltip (welcome/done steps)
    tooltipStyle = {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }

  return (
    <>
      {/* Dim overlay */}
      <div
        className="fixed inset-0 z-50 bg-black/55 transition-opacity"
        onClick={skip}
      />

      {/* Glow ring around target */}
      {highlightStyle && <div style={highlightStyle} />}

      {/* Tooltip */}
      <div
        style={{ position: 'fixed', width: tooltipWidth, zIndex: 52, ...tooltipStyle }}
        className="bg-card border border-border rounded-xl shadow-2xl p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-2 mb-2">
          {isFirst && <Sparkles size={14} className="text-foreground mt-0.5 shrink-0" />}
          <h3 className="text-sm font-semibold text-foreground flex-1 leading-tight">{step.title}</h3>
          <button
            onClick={skip}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 -mt-0.5 -mr-0.5"
            aria-label="Close tour"
          >
            <X size={14} />
          </button>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed mb-4">{step.body}</p>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1 rounded-full transition-all ${
                  i === stepIndex ? 'w-4 bg-foreground' : i < stepIndex ? 'w-1 bg-foreground/60' : 'w-1 bg-border'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!isLast && (
              <button
                onClick={skip}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip
              </button>
            )}
            <button
              onClick={next}
              className="flex items-center gap-1 text-xs px-3 py-1.5 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity"
            >
              {isLast ? 'Got it' : isFirst ? 'Start' : 'Next'}
              {!isLast && <ArrowRight size={11} />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// Programmatic re-entry, call from a "Take the tour again" button
export async function restartTour() {
  if (typeof window === 'undefined') return;
  try {
    await fetch('/api/tour/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Reset by clearing both, server endpoint accepts a `reset` flag via body
      body: JSON.stringify({ kind: 'main', reset: true }),
    });
  } catch {}
  window.location.reload();
}
