'use client';

import { useState, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Zap, Loader2, Plus } from 'lucide-react';
import type { Column, Draft } from './types';
import { DraftCard } from './draft-card';

interface KanbanColumnProps {
  column: Column;
  drafts: Draft[];
  onCardClick: (id: string) => void;
  onQuickGenerate?: (id: string) => Promise<void | boolean>;
  onQuickAdvance?: (id: string) => void;
  onGenerateAll?: () => Promise<void>;
  onAddIdea?: (topic: string) => void;
  nextLabel?: string;
}

export function KanbanColumn({
  column,
  drafts,
  onCardClick,
  onQuickGenerate,
  onQuickAdvance,
  onGenerateAll,
  onAddIdea,
  nextLabel,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const ids = drafts.map(d => d.id);
  const realIdeas = drafts.filter(d => !d.isDemo);

  const [generatingAll, setGeneratingAll] = useState(false);
  const [addingIdea, setAddingIdea] = useState(false);
  const [ideaInput, setIdeaInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleGenerateAll(e: React.MouseEvent) {
    e.stopPropagation();
    if (generatingAll || !onGenerateAll) return;
    setGeneratingAll(true);
    await onGenerateAll();
    setGeneratingAll(false);
  }

  function handleIdeaKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && ideaInput.trim()) {
      onAddIdea?.(ideaInput.trim());
      setIdeaInput('');
      setAddingIdea(false);
    }
    if (e.key === 'Escape') {
      setIdeaInput('');
      setAddingIdea(false);
    }
  }

  return (
    <div className="flex flex-col min-w-[220px] w-[220px] shrink-0">
      {/* Column header */}
      <div className="flex items-center gap-2 px-1 mb-3">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: column.dot }} />
        <span className="text-xs font-semibold text-foreground tracking-wide uppercase">
          {column.label}
        </span>
        <span className="text-xs text-muted-foreground tabular">
          {drafts.length || ''}
        </span>

        {onGenerateAll && realIdeas.length > 0 && (
          <button
            onClick={handleGenerateAll}
            disabled={generatingAll}
            className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Generate all ideas"
          >
            {generatingAll
              ? <Loader2 size={10} className="animate-spin" />
              : <Zap size={10} />
            }
            {generatingAll ? 'Running...' : 'All'}
          </button>
        )}
      </div>

      {/* Drop zone */}
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`flex-1 min-h-[80px] space-y-2 rounded-md transition-colors
            ${isOver ? 'bg-accent/60 ring-1 ring-border' : ''}
          `}
        >
          {drafts.map(draft => (
            <DraftCard
              key={draft.id}
              draft={draft}
              onClick={() => onCardClick(draft.id)}
              onGenerate={onQuickGenerate && !draft.isDemo ? () => onQuickGenerate(draft.id) : undefined}
              onAdvance={onQuickAdvance && !draft.isDemo ? () => onQuickAdvance(draft.id) : undefined}
              nextLabel={nextLabel}
            />
          ))}

          {drafts.length === 0 && !isOver && !addingIdea && (
            <div className="border border-dashed border-border rounded-md h-16 flex items-center justify-center">
              <span className="text-xs text-muted-foreground/50">empty</span>
            </div>
          )}

          {/* Quick-add for Ideas column */}
          {onAddIdea && (
            addingIdea ? (
              <input
                ref={inputRef}
                autoFocus
                value={ideaInput}
                onChange={e => setIdeaInput(e.target.value)}
                onKeyDown={handleIdeaKeyDown}
                onBlur={() => { setAddingIdea(false); setIdeaInput(''); }}
                placeholder="Topic or angle..."
                className="w-full text-xs px-3 py-2 bg-card border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            ) : (
              <button
                onClick={() => setAddingIdea(true)}
                className="w-full flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors px-1 py-1.5"
              >
                <Plus size={11} />
                Add idea
              </button>
            )
          )}
        </div>
      </SortableContext>
    </div>
  );
}
