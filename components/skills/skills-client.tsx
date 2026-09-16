'use client';

import { useState } from 'react';
import { ToggleLeft, ToggleRight, Brain, Lock, Sparkles } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export interface DbSkill {
  id: string;
  name: string;
  kind: string;
  status: string;
  source: string;
  confidence: number;
  timesApplied: number;
  createdAt: string;
}

const KIND_META: Record<string, { label: string; color: string }> = {
  hook_formula:       { label: 'Hook',      color: '#2383E2' },
  structure_template: { label: 'Structure', color: '#8B5CF6' },
  voice_rule:         { label: 'Voice',     color: '#D5A843' },
  format_rule:        { label: 'Format',    color: '#6B7280' },
  avoidance_rule:     { label: 'Avoid',     color: '#E03E3E' },
};

function kindMeta(kind: string) {
  return KIND_META[kind] ?? { label: kind, color: '#6B7280' };
}

function confidenceBar(c: number) {
  if (c >= 0.8) return '#2383E2';
  if (c >= 0.6) return '#D5A843';
  return '#9B8EA0';
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SkillCard({ skill, onToggle }: {
  skill: DbSkill;
  onToggle: (id: string, next: 'active' | 'dismissed') => void;
}) {
  const isActive = skill.status === 'active';
  const isConsolidated = skill.source === 'consolidated';
  const meta = kindMeta(skill.kind);
  const barColor = confidenceBar(skill.confidence);
  const confidencePct = Math.round(skill.confidence * 100);

  return (
    <div className={`relative bg-card border border-border rounded-md px-4 py-3.5 transition-opacity ${isActive ? '' : 'opacity-50'}`}>
      <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-l-md" style={{ backgroundColor: meta.color }} />
      <div className="ml-1 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{skill.name}</span>
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
              style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
            >
              {meta.label}
            </span>
            {isConsolidated && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 flex items-center gap-1">
                <Sparkles size={8} /> Weekly synthesis
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {isConsolidated ? 'Synthesized' : skill.source === 'auto' ? 'Auto-learned' : 'Manual'} · {timeAgo(skill.createdAt)}
            </span>
          </div>

          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">Strength</span>
              <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${confidencePct}%`, backgroundColor: barColor }} />
              </div>
              <span className="tabular text-[10px] font-semibold" style={{ color: barColor }}>{confidencePct}%</span>
            </div>
            {skill.timesApplied > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Applied</span>
                <span className="tabular text-[10px] text-foreground">{skill.timesApplied}x</span>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={() => onToggle(skill.id, isActive ? 'dismissed' : 'active')}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
          title={isActive ? 'Disable' : 'Enable'}
        >
          {isActive
            ? <ToggleRight size={20} className="text-primary" />
            : <ToggleLeft size={20} />}
        </button>
      </div>
    </div>
  );
}

type Tab = 'active' | 'dismissed';

export function SkillsClient({
  initialSkills,
  globalRuleCount,
}: {
  initialSkills: DbSkill[];
  globalRuleCount: number;
}) {
  const [skills, setSkills] = useState<DbSkill[]>(initialSkills);
  const [tab, setTab] = useState<Tab>('active');

  async function handleToggle(id: string, next: 'active' | 'dismissed') {
    setSkills(prev => prev.map(s => s.id === id ? { ...s, status: next } : s));
    await fetch(`/api/skills/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    }).catch(() => {
      setSkills(prev => prev.map(s => s.id === id ? { ...s, status: next === 'active' ? 'dismissed' : 'active' } : s));
    });
  }

  const activeSkills = skills.filter(s => s.status === 'active');
  const dismissedSkills = skills.filter(s => s.status === 'dismissed');
  const shown = tab === 'active' ? activeSkills : dismissedSkills;

  return (
    <div className="p-8 lg:p-10 w-full">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Writing rules enforced on every post.{' '}
            <span className="font-medium text-foreground">{activeSkills.length}</span> brand{' '}
            {activeSkills.length === 1 ? 'rule' : 'rules'} active.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[#529E63] bg-[#529E63]/10 border border-[#529E63]/20 px-3 py-1.5 rounded-md">
          <Brain size={12} />
          Self-improving
        </div>
      </div>

      {/* Tab row */}
      <div className="flex gap-1 mb-5 border-b border-border">
        {(['active', 'dismissed'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t} {t === 'active' ? `(${activeSkills.length})` : `(${dismissedSkills.length})`}
          </button>
        ))}
      </div>

      {/* Brand skills */}
      {shown.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mb-8">
          {shown.map(skill => (
            <SkillCard key={skill.id} skill={skill} onToggle={handleToggle} />
          ))}
        </div>
      ) : (
        <div className="mb-8">
          <EmptyState
            icon={Brain}
            title={tab === 'active' ? 'No brand skills yet' : 'Nothing dismissed'}
            description={tab === 'active'
              ? 'Open any board post, go to the Revise panel, and accept a revision. Lore will extract a writing rule from the change automatically.'
              : 'Dismissed skills are inactive but not deleted. Re-enable them here anytime.'}
            primary={tab === 'active' ? { label: 'Go to board', href: '/board' } : undefined}
          />
        </div>
      )}

      {/* Global rules: count only, no text exposed */}
      {tab === 'active' && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-md border border-border bg-card">
          <Lock size={13} className="text-muted-foreground/50 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground">
              {globalRuleCount} platform-wide rules
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Always enforced, and updated as Lore learns what works in your niche.
            </p>
          </div>
          <span className="text-[10px] font-semibold px-2 py-1 rounded bg-muted text-muted-foreground shrink-0">
            Always on
          </span>
        </div>
      )}
    </div>
  );
}
