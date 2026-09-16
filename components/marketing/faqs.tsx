'use client';

import { useState } from 'react';

// Family's FAQ split: heading holds the left column, rows sit on the right,
// blunt short questions. The most-asked one (Endless) starts open.

export interface Faq {
  q: string;
  a: string;
}

export function Faqs({ items }: { items: Faq[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="grid lg:grid-cols-[0.8fr_1.2fr] gap-10">
      <h2 className="text-2xl font-semibold tracking-tight">FAQs</h2>
      <div className="border-t border-border">
        {items.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={item.q} className="border-b border-border">
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="w-full flex items-start justify-between gap-6 py-4 text-left group"
              >
                <span className="text-[15px] font-medium text-foreground">{item.q}</span>
                <span
                  className={`shrink-0 mt-0.5 text-primary transition-transform duration-200 ${isOpen ? 'rotate-45' : ''}`}
                  aria-hidden
                >
                  +
                </span>
              </button>
              <div className={`overflow-hidden transition-all duration-200 ${isOpen ? 'max-h-64 pb-4' : 'max-h-0'}`}>
                <p className="text-muted-foreground leading-relaxed pr-10">{item.a}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
