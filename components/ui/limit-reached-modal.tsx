'use client';

import { useEffect, useState } from 'react';
import { Zap, X, ArrowRight, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface Props {
  limit: number;
  onUseCredits: () => Promise<void>;
  onClose: () => void;
}

export function LimitReachedModal({ limit, onUseCredits, onClose }: Props) {
  const [credits, setCredits] = useState<number | null>(null);
  const [using, setUsing] = useState(false);

  useEffect(() => {
    fetch('/api/credits')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setCredits(d.isUnlimited ? Infinity : d.balance); })
      .catch(() => {});
  }, []);

  async function handleUseCredits() {
    setUsing(true);
    try {
      await onUseCredits();
    } finally {
      setUsing(false);
    }
  }

  const canUseCredits = credits === null || credits === Infinity || credits >= 10;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <X size={14} />
        </button>

        <div className="mb-4">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-3">
            <Zap size={16} className="text-amber-500" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Daily limit reached</h2>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            You&apos;ve used all {limit} free AI generates for today. Resets at midnight UTC.
          </p>
        </div>

        <div className="space-y-2">
          <button
            onClick={handleUseCredits}
            disabled={!canUseCredits || using}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-border bg-foreground text-background text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            <span className="flex items-center gap-2">
              {using ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
              {using ? 'Generating...' : 'Use 10 credits instead'}
            </span>
            {credits !== null && (
              <span className="text-[10px] opacity-60">
                {credits === Infinity ? 'Unlimited' : `${credits} remaining`}
              </span>
            )}
          </button>

          {credits !== null && credits !== Infinity && credits < 10 && (
            <p className="text-[11px] text-destructive text-center">Not enough credits (need 10, have {credits})</p>
          )}

          <Link
            href="/settings"
            onClick={onClose}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <span>Upgrade for more generates</span>
            <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}
