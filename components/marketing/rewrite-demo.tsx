'use client';

import { useMemo, useRef, useState } from 'react';
import { detectPatterns, type PatternHit } from '@/lib/pattern-detector';

const BEFORE = `In today's fast-paced landscape, most founders delve into growth tactics that simply don't move the needle.

Here's the truth: it's not about doing more. It's about doing less, better.

We didn't chase every channel. We picked one and went deep. The results speak for themselves — a robust, seamless pipeline.`;

const AFTER = `most founders i talk to are running six growth experiments at once, and none of them get enough attention to work.

we cut to one channel in march, three linkedin posts a week written straight from customer calls.

by june it was bringing in 40% of our pipeline, mostly because we finally stopped spreading ourselves thin.`;

interface Segment {
  text: string;
  hit?: PatternHit;
}

function segment(text: string, hits: PatternHit[]): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  for (const hit of [...hits].sort((a, b) => a.index - b.index)) {
    if (hit.index < cursor) continue;
    if (hit.index > cursor) out.push({ text: text.slice(cursor, hit.index) });
    out.push({ text: text.slice(hit.index, hit.index + hit.match.length), hit });
    cursor = hit.index + hit.match.length;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}

export function RewriteDemo() {
  const [mode, setMode] = useState<'before' | 'after'>('before');
  const [text, setText] = useState(BEFORE);
  const layer = useRef<HTMLDivElement>(null);

  const edited = text !== BEFORE;
  const shown = mode === 'after' && !edited ? AFTER : text;

  const hits = useMemo(() => detectPatterns(shown).filter((h) => h.tier === 1), [shown]);
  const segments = useMemo(() => segment(shown, hits), [shown, hits]);
  const clean = hits.length === 0 && shown.trim().length > 0;

  return (
    <div className="rounded-2xl border border-[#E4E2DD] bg-white shadow-[0_2px_4px_rgba(55,53,47,0.04),0_32px_72px_-24px_rgba(55,53,47,0.3)] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#EDEBE6] bg-[#FBFAF8]">
        <div className="flex rounded-md bg-[#EFEDE8] p-0.5" role="tablist">
          {(['before', 'after'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-[5px] px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                mode === m ? 'bg-white text-foreground shadow-[0_1px_2px_rgba(55,53,47,0.1)]' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {m === 'before' ? 'Before' : 'After Lore'}
            </button>
          ))}
        </div>
        <span
          className={`font-mono text-[11px] px-2 py-1 rounded-[4px] transition-colors ${
            clean ? 'bg-[#E6F4EA] text-[#1E7B3A]' : 'bg-[#FCEBE9] text-[#B0322A]'
          }`}
        >
          {clean ? 'reads human' : `${hits.length} AI tell${hits.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {mode === 'after' && edited ? (
        <div className="h-[236px] grid place-items-center px-8 text-center">
          <p className="text-[15px] text-muted-foreground leading-relaxed max-w-xs">
            Install Lore and it rewrites your own drafts like this, in the voice it learns from your posts
          </p>
        </div>
      ) : (
        <div className="relative">
          <div
            ref={layer}
            aria-hidden
            className="pointer-events-none absolute inset-0 px-5 py-4 whitespace-pre-wrap break-words text-[15px] leading-[1.62] overflow-hidden"
          >
            {segments.map((s, i) =>
              s.hit ? (
                <mark
                  key={i}
                  className="bg-[#FBE3E0] text-[#8E2B23] rounded-[3px] box-decoration-clone underline decoration-[#D2402F] decoration-wavy decoration-[1.5px] underline-offset-[3px]"
                >
                  {s.text}
                </mark>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </div>
          <textarea
            value={shown}
            readOnly={mode === 'after'}
            onChange={(e) => setText(e.target.value)}
            onScroll={(e) => {
              if (layer.current) layer.current.scrollTop = e.currentTarget.scrollTop;
            }}
            spellCheck={false}
            aria-label="Paste a post to check it for AI tells"
            className="relative block w-full h-[236px] resize-none bg-transparent px-5 py-4 text-[15px] leading-[1.62] text-transparent caret-[#2383E2] outline-none"
          />
        </div>
      )}

      <div className="border-t border-[#EDEBE6] px-5 py-3 text-[13px] text-muted-foreground bg-[#FCFBF9]">
        {mode === 'before'
          ? edited
            ? 'Checking your text live, in your browser. Switch to After to see what Lore does with it.'
            : 'Red is what gives AI writing away. Paste your own post over it, or flip to After.'
          : edited
            ? 'Nothing you typed was sent anywhere.'
            : 'Same point, no tells, sounds like a person. That is every draft Lore hands you.'}
      </div>
    </div>
  );
}
