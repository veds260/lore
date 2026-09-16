'use client';

import { useEffect, useState } from 'react';
import { AppPanel } from '@/components/marketing/app-panel';
import { RewriteDemo } from '@/components/marketing/rewrite-demo';
import { TelegramPanel } from '@/components/marketing/telegram-panel';

const CHAPTERS = [
  { title: 'Reads your posts' },
  { title: 'Strips the AI tells' },
  { title: 'Finds you on Telegram' },
];

const DWELL_MS = 8000;

// The product walkthrough lives in one frame that steps through itself, so the
// page never has to scroll to tell the story. Clicking a chapter stops the tour.
export function ProductTour() {
  const [active, setActive] = useState(0);
  const [touring, setTouring] = useState(true);

  useEffect(() => {
    if (!touring || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => setActive((a) => (a + 1) % CHAPTERS.length), DWELL_MS);
    return () => clearTimeout(t);
  }, [active, touring]);

  return (
    <div onPointerDown={() => setTouring(false)} onFocusCapture={() => setTouring(false)}>
      <div className="grid grid-cols-3 gap-2" role="tablist">
        {CHAPTERS.map((c, i) => {
          const on = i === active;
          return (
            <button
              key={c.title}
              role="tab"
              aria-selected={on}
              onClick={() => { setActive(i); setTouring(false); }}
              className="group text-left"
            >
              <span className="block h-[3px] rounded-[2px] bg-[#E7E4DE] overflow-hidden">
                <span
                  key={`${active}-${touring}`}
                  className={`block h-full bg-foreground ${on ? (touring ? 'lore-fill' : 'w-full') : 'w-0'}`}
                  style={on && touring ? { animationDuration: `${DWELL_MS}ms` } : undefined}
                />
              </span>
              <span className={`mt-2.5 block text-[13px] font-medium transition-colors ${on ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}>
                <span className="font-mono text-[11px] mr-1.5 opacity-60">{i + 1}</span>
                {c.title}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] items-start lg:h-[480px]">
        {[<AppPanel key="a" />, <RewriteDemo key="b" />, <div key="c" className="flex justify-center"><TelegramPanel /></div>].map((panel, i) => (
          <div
            key={i}
            aria-hidden={i !== active}
            className={`col-start-1 row-start-1 transition-all duration-500 ${
              i === active ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
            }`}
          >
            {panel}
          </div>
        ))}
      </div>
    </div>
  );
}
