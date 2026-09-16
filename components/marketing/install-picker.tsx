'use client';

import { useState } from 'react';
import { CommandBlock } from '@/components/marketing/command-block';

const OPTIONS = [
  { id: 'terminal', label: 'Terminal', command: 'curl -fsSL https://raw.githubusercontent.com/veds260/lore/main/install.sh | sh', note: 'Installs it, then opens your browser to finish setup' },
  { id: 'claude', label: 'Inside Claude', command: 'claude mcp add lore -- npm --prefix ~/lore run mcp', note: 'Run this after installing and Claude can write in your voice' },
];

export function InstallPicker() {
  const [pick, setPick] = useState(0);
  const o = OPTIONS[pick];
  return (
    <div>
      <div className="flex gap-4 mb-2.5" role="tablist">
        {OPTIONS.map((opt, i) => (
          <button
            key={opt.id}
            role="tab"
            aria-selected={i === pick}
            onClick={() => setPick(i)}
            className={`text-[12.5px] pb-1 border-b-2 transition-colors ${
              i === pick ? 'border-foreground text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <CommandBlock command={o.command} wrap />
      <p className="mt-2.5 text-[13px] text-muted-foreground">{o.note}</p>
    </div>
  );
}
