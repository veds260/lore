'use client';

import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Zap, ArrowRight, Loader2 } from 'lucide-react';
import type { Draft } from './types';

function platformLabel(p: Draft['platform']) {
  if (p === 'twitter') return 'X';
  if (p === 'linkedin') return 'LI';
  return 'X · LI';
}

export function DraftCard({
  draft,
  onClick,
  overlay = false,
  onGenerate,
  onAdvance,
  nextLabel,
}: {
  draft: Draft;
  onClick?: () => void;
  overlay?: boolean;
  onGenerate?: () => Promise<void | boolean>;
  onAdvance?: () => void;
  nextLabel?: string;
}) {
  const [generating, setGenerating] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: draft.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const hook = draft.content.split('\n')[0].slice(0, 80);
  const rest = draft.content.slice(hook.length).trim().slice(0, 80);

  async function handleGenerate(e: React.MouseEvent) {
    e.stopPropagation();
    if (generating || !onGenerate) return;
    setGenerating(true);
    await onGenerate();
    setGenerating(false);
  }

  function handleAdvance(e: React.MouseEvent) {
    e.stopPropagation();
    onAdvance?.();
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative bg-card border border-border rounded-md px-3 py-2.5 cursor-pointer select-none
        hover:border-muted-foreground/40 transition-colors
        ${isDragging && !overlay ? 'opacity-30' : ''}
        ${overlay ? 'shadow-md rotate-1 opacity-95' : ''}
        ${draft.isDemo ? 'opacity-60' : ''}
        ${generating ? 'opacity-70' : ''}
      `}
      onClick={onClick}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 cursor-grab active:cursor-grabbing"
        onClick={e => e.stopPropagation()}
      >
        <GripVertical size={13} className="text-muted-foreground" />
      </div>

      {/* Content preview */}
      <div className="ml-3 space-y-0.5">
        <p className="text-sm text-foreground font-medium leading-snug line-clamp-2">
          {hook}
        </p>
        {rest && (
          <p className="text-xs text-muted-foreground leading-snug line-clamp-1">
            {rest}
          </p>
        )}
      </div>

      {/* Footer row */}
      <div className="mt-2 ml-3 flex items-center gap-2">
        <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          {platformLabel(draft.platform)}
        </span>
        {draft.isDemo && (
          <span className="text-[10px] font-medium text-muted-foreground/70 bg-muted/60 px-1.5 py-0.5 rounded">
            Example
          </span>
        )}

        {/* Quick actions */}
        {onGenerate && !draft.isDemo && (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="ml-auto flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-foreground/8 text-foreground hover:bg-foreground/15 transition-colors disabled:opacity-50"
          >
            {generating
              ? <><Loader2 size={9} className="animate-spin" /> Writing...</>
              : <><Zap size={9} /> Generate</>
            }
          </button>
        )}

        {onAdvance && nextLabel && !draft.isDemo && (
          <button
            onClick={handleAdvance}
            className="ml-auto flex items-center gap-1 text-[10px] font-medium text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-all"
          >
            {nextLabel} <ArrowRight size={9} />
          </button>
        )}
      </div>
    </div>
  );
}
