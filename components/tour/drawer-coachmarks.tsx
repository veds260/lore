'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, ArrowRight, Sparkles } from 'lucide-react';
import { resolveTooltipPosition, scrollTargetIntoView } from './position';

interface Step {
  target: string;
  title: string;
  body: string;
  position: 'left' | 'right' | 'top' | 'bottom';
}

const STEPS: Step[] = [
  {
    target: '[data-tour="drawer-revise"]',
    title: 'Revise: ask for changes in plain English',
    body: 'Tell Lore exactly what to fix: "make the hook punchier" or "rewrite the second line in my voice." The AI revises just that part.',
    position: 'bottom',
  },
  {
    target: '[data-tour="drawer-image"]',
    title: 'Generate a matching image',
    body: 'Lore creates a visual that fits the post: square for X, landscape for LinkedIn, or banner-style. Auto-attaches to the draft.',
    position: 'top',
  },
  {
    target: '[data-tour="drawer-format"]',
    title: 'Use a proven format',
    body: 'When you turn an idea into a draft, toggle this to write using a viral structure from your library, a tested template, applied to your voice.',
    position: 'top',
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

interface Props {
  isOpen: boolean;
}

export function DrawerCoachmarks({ isOpen }: Props) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  // Only fire once per user (server-tracked), only after main tour completed, only when drawer opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/tour/status')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) return;
        if (data.drawerCompleted) return; // already seen drawer coachmarks
        if (!data.mainCompleted) return; // don't pile on top of main tour
        // Wait for drawer slide-in animation
        setTimeout(() => { if (!cancelled) setActive(true); }, 500);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isOpen]);

  // Close coachmarks if user closes the drawer
  useEffect(() => {
    if (!isOpen && active) {
      finish(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const updateRect = useCallback(async () => {
    const step = STEPS[stepIndex];
    if (!step) return;
    // Auto-scroll the target into view (inside the drawer or main scroller) before measuring
    await scrollTargetIntoView(step.target);
    const r = getRect(step.target);
    // If the target isn't in the DOM (e.g. drawer-format only renders for idea-status drafts)
    // OR has no visible dimensions, skip this step instead of showing a floating tooltip.
    if (!r || r.width === 0 || r.height === 0) {
      if (stepIndex < STEPS.length - 1) {
        setStepIndex(i => i + 1);
      } else {
        finish(true);
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
    return () => window.removeEventListener('resize', onResize);
  }, [active, updateRect]);

  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') finish(true);
      if (e.key === 'Enter') next();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex]);

  function next() {
    if (stepIndex >= STEPS.length - 1) {
      finish(true);
    } else {
      setStepIndex(i => i + 1);
    }
  }

  function finish(persist: boolean) {
    setActive(false);
    if (persist) {
      fetch('/api/tour/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'drawer' }),
      }).catch(() => {});
    }
  }

  if (!active) return null;

  const step = STEPS[stepIndex];
  const tooltipWidth = 280;
  const margin = 14;
  const isLast = stepIndex === STEPS.length - 1;

  let tooltipStyle: React.CSSProperties = {};
  let highlightStyle: React.CSSProperties | null = null;

  if (rect) {
    highlightStyle = {
      position: 'fixed',
      top: rect.top - 5,
      left: rect.left - 5,
      width: rect.width + 10,
      height: rect.height + 10,
      borderRadius: 10,
      boxShadow: '0 0 0 3px rgba(255,255,255,0.95), 0 0 0 6px rgba(82,158,99,0.4), 0 0 30px rgba(82,158,99,0.3)',
      pointerEvents: 'none',
      zIndex: 61,
      transition: 'all 0.2s ease',
    };

    if (typeof window !== 'undefined') {
      const resolved = resolveTooltipPosition({
        rect,
        preferred: step.position,
        tooltipWidth,
        margin,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
      tooltipStyle = resolved.style;
    }
  }

  return (
    <>
      {/* Soft dim overlay, drawer stays visible but other parts are dimmed */}
      <div
        className="fixed inset-0 z-[60] bg-black/40"
        onClick={() => finish(true)}
      />

      {highlightStyle && <div style={highlightStyle} />}

      <div
        style={{ position: 'fixed', width: tooltipWidth, zIndex: 62, ...tooltipStyle }}
        className="bg-card border border-border rounded-xl shadow-2xl p-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-2 mb-1.5">
          <Sparkles size={12} className="text-foreground mt-0.5 shrink-0" />
          <h3 className="text-sm font-semibold text-foreground flex-1 leading-tight">{step.title}</h3>
          <button
            onClick={() => finish(true)}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 -mt-0.5 -mr-0.5"
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed mb-3">{step.body}</p>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1 rounded-full transition-all ${
                  i === stepIndex ? 'w-3 bg-foreground' : i < stepIndex ? 'w-1 bg-foreground/60' : 'w-1 bg-border'
                }`}
              />
            ))}
          </div>
          <button
            onClick={next}
            className="flex items-center gap-1 text-xs px-2.5 py-1 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity"
          >
            {isLast ? 'Got it' : 'Next'}
            {!isLast && <ArrowRight size={10} />}
          </button>
        </div>
      </div>
    </>
  );
}
