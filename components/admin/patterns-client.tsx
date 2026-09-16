'use client';

import { useState, useCallback, useEffect, useRef, ChangeEvent } from 'react';
import { Search, Plus, Trash2, Power, PowerOff, ChevronLeft, ChevronRight, ExternalLink, X, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AdminNav } from '@/components/admin/users-client';

interface Pattern {
  id: string;
  name: string;
  description: string | null;
  template?: string | null;
  example: string | null;
  hookType: string | null;
  formatType: string | null;
  bodyStructure: string | null;
  closerType: string | null;
  engagementTarget: string | null;
  coreInsight?: string | null;
  viralMechanic: string | null;
  emotionTrigger: string | null;
  postType: string | null;
  contentCategory?: string | null;
  reusableFor: string[] | null;
  tweetUrl: string | null;
  isActive: boolean;
  isQrt: boolean;
  createdAt: string;
}

interface PageData {
  total: number;
  page: number;
  pageSize: number;
  patterns: Pattern[];
  byHook: { hookType: string | null; count: number }[];
}

// ─── Content category config ──────────────────────────────────────────────────

const CONTENT_CATEGORIES: { slug: string; label: string }[] = [
  { slug: 'build-in-public',      label: 'Build in Public' },
  { slug: 'thought-leadership',   label: 'Thought Leadership' },
  { slug: 'thesis-building',      label: 'Thesis Building' },
  { slug: 'ragebait',             label: 'Ragebait' },
  { slug: 'storytelling',         label: 'Storytelling' },
  { slug: 'authority',            label: 'Authority Post' },
  { slug: 'article',              label: 'Article' },
  { slug: 'visual',               label: 'Visual' },
  { slug: 'educational',          label: 'Educational' },
  { slug: 'contrarian-take',      label: 'Contrarian Take' },
  { slug: 'hot-take',             label: 'Hot Take' },
  { slug: 'case-study',           label: 'Case Study' },
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CONTENT_CATEGORIES.map(c => [c.slug, c.label])
);

// ─── Chip color map ───────────────────────────────────────────────────────────

const CHIP_COLORS: Record<string, string> = {
  contrarian: 'bg-red-950 text-red-300',
  story: 'bg-blue-950 text-blue-300',
  stat: 'bg-purple-950 text-purple-300',
  outcome: 'bg-green-950 text-green-300',
  question: 'bg-yellow-950 text-yellow-300',
  tweet: 'bg-sky-950 text-sky-300',
  thread: 'bg-indigo-950 text-indigo-300',
  'long-post': 'bg-orange-950 text-orange-300',
  save: 'bg-emerald-950 text-emerald-300',
  share: 'bg-violet-950 text-violet-300',
  reply: 'bg-pink-950 text-pink-300',
};

function Chip({ label }: { label: string }) {
  const color = CHIP_COLORS[label] ?? 'bg-zinc-800 text-zinc-400';
  return (
    <span className={cn('inline-block rounded px-1.5 py-0.5 text-[10px] font-medium leading-none', color)}>
      {label}
    </span>
  );
}

// ─── Common form styles ───────────────────────────────────────────────────────

const inputCls = 'w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500';
const textareaCls = 'w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500 resize-y font-mono';
const labelCls = 'block text-[11px] text-zinc-400 mb-1';

// ─── Detail slide-over ────────────────────────────────────────────────────────

interface DetailPanelProps {
  pattern: Pattern;
  onClose: () => void;
  onUpdated: (updated: Pattern) => void;
}

type EditForm = {
  name: string;
  description: string;
  template: string;
  example: string;
  hookType: string;
  formatType: string;
  bodyStructure: string;
  closerType: string;
  engagementTarget: string;
  coreInsight: string;
  viralMechanic: string;
  emotionTrigger: string;
  reusableFor: string;
  postType: string;
  contentCategory: string;
  tweetUrl: string;
};

function patternToForm(p: Pattern): EditForm {
  return {
    name: p.name,
    description: p.description ?? '',
    template: p.template ?? '',
    example: p.example ?? '',
    hookType: p.hookType ?? '',
    formatType: p.formatType ?? '',
    bodyStructure: p.bodyStructure ?? '',
    closerType: p.closerType ?? '',
    engagementTarget: p.engagementTarget ?? '',
    coreInsight: p.coreInsight ?? '',
    viralMechanic: p.viralMechanic ?? '',
    emotionTrigger: p.emotionTrigger ?? '',
    reusableFor: (p.reusableFor ?? []).join(', '),
    postType: p.postType ?? 'tweet',
    contentCategory: p.contentCategory ?? '',
    tweetUrl: p.tweetUrl ?? '',
  };
}

function DetailPanel({ pattern, onClose, onUpdated }: DetailPanelProps) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm>(patternToForm(pattern));
  const [saving, setSaving] = useState(false);

  function field(key: keyof EditForm) {
    return (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        id: pattern.id,
        ...form,
        reusableFor: form.reusableFor.split(',').map(s => s.trim()).filter(Boolean),
      };
      const res = await fetch('/api/admin/patterns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const updated: Pattern = {
          ...pattern,
          name: form.name,
          description: form.description || null,
          template: form.template || null,
          example: form.example || null,
          hookType: form.hookType || null,
          formatType: form.formatType || null,
          bodyStructure: form.bodyStructure || null,
          closerType: form.closerType || null,
          engagementTarget: form.engagementTarget || null,
          coreInsight: form.coreInsight || null,
          viralMechanic: form.viralMechanic || null,
          emotionTrigger: form.emotionTrigger || null,
          reusableFor: form.reusableFor.split(',').map(s => s.trim()).filter(Boolean),
          postType: form.postType || null,
          contentCategory: form.contentCategory || null,
          tweetUrl: form.tweetUrl || null,
        };
        onUpdated(updated);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-[520px] bg-zinc-950 border-l border-zinc-800 z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <p className="text-sm font-semibold text-zinc-100 truncate pr-4">{pattern.name}</p>
          <div className="flex items-center gap-2 shrink-0">
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition-colors border border-zinc-700 rounded-md px-2.5 py-1"
              >
                <Pencil size={11} /> Edit
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {editing ? (
            <>
              <div>
                <label className={labelCls}>Name *</label>
                <input value={form.name} onChange={field('name')} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <input value={form.description} onChange={field('description')} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Template *</label>
                <textarea value={form.template} onChange={field('template')} rows={6} className={textareaCls} />
              </div>
              <div>
                <label className={labelCls}>Example Post</label>
                <textarea value={form.example} onChange={field('example')} rows={5} className={textareaCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Hook Type</label>
                  <input value={form.hookType} onChange={field('hookType')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Format Type</label>
                  <input value={form.formatType} onChange={field('formatType')} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Body Structure</label>
                  <input value={form.bodyStructure} onChange={field('bodyStructure')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Closer Type</label>
                  <input value={form.closerType} onChange={field('closerType')} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Engagement Target</label>
                  <input value={form.engagementTarget} onChange={field('engagementTarget')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Emotion Trigger</label>
                  <input value={form.emotionTrigger} onChange={field('emotionTrigger')} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Core Insight</label>
                <input value={form.coreInsight} onChange={field('coreInsight')} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Viral Mechanic</label>
                <input value={form.viralMechanic} onChange={field('viralMechanic')} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Post Type</label>
                  <input value={form.postType} onChange={field('postType')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Content Category</label>
                  <select value={form.contentCategory} onChange={field('contentCategory')} className={inputCls}>
                    <option value="">- none -</option>
                    {CONTENT_CATEGORIES.map(c => (
                      <option key={c.slug} value={c.slug}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>Reusable For (comma-separated)</label>
                <input value={form.reusableFor} onChange={field('reusableFor')} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Source Tweet URL</label>
                <input value={form.tweetUrl} onChange={field('tweetUrl')} className={inputCls} />
              </div>
            </>
          ) : (
            <>
              {/* View mode */}
              {pattern.contentCategory && (
                <div>
                  <p className={labelCls}>Content Category</p>
                  <span className="inline-block rounded px-2 py-0.5 text-[11px] font-medium bg-amber-950 text-amber-300">
                    {CATEGORY_LABEL[pattern.contentCategory] ?? pattern.contentCategory}
                  </span>
                </div>
              )}
              {pattern.isQrt && (
                <div className="rounded-lg border border-cyan-900 bg-cyan-950/40 px-3 py-2">
                  <p className="text-[11px] font-semibold text-cyan-400 mb-0.5">Quote Repost (QRT)</p>
                  <p className="text-[11px] text-cyan-600">This pattern requires a source tweet to react to. It won&apos;t work as a standalone post.</p>
                </div>
              )}
              {pattern.description && (
                <div>
                  <p className={labelCls}>Description</p>
                  <p className="text-xs text-zinc-300">{pattern.description}</p>
                </div>
              )}
              {pattern.template && (
                <div>
                  <p className={labelCls}>Template</p>
                  <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono bg-zinc-900 rounded-lg border border-zinc-800 p-3 leading-relaxed">
                    {pattern.template}
                  </pre>
                </div>
              )}
              {pattern.example && (
                <div>
                  <p className={labelCls}>Example Post</p>
                  <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
                    <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{pattern.example}</p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {[
                  ['Hook Type', pattern.hookType],
                  ['Format Type', pattern.formatType],
                  ['Body Structure', pattern.bodyStructure],
                  ['Closer Type', pattern.closerType],
                  ['Engagement Target', pattern.engagementTarget],
                  ['Emotion Trigger', pattern.emotionTrigger],
                  ['Post Type', pattern.postType],
                  ['Viral Mechanic', pattern.viralMechanic],
                ].map(([label, value]) =>
                  value ? (
                    <div key={label as string}>
                      <p className={labelCls}>{label}</p>
                      <p className="text-xs text-zinc-200">{value}</p>
                    </div>
                  ) : null
                )}
              </div>
              {pattern.coreInsight && (
                <div>
                  <p className={labelCls}>Core Insight</p>
                  <p className="text-xs text-zinc-300 italic">{pattern.coreInsight}</p>
                </div>
              )}
              {pattern.reusableFor && pattern.reusableFor.length > 0 && (
                <div>
                  <p className={labelCls}>Reusable For</p>
                  <div className="flex flex-wrap gap-1">
                    {pattern.reusableFor.map(tag => (
                      <span key={tag} className="text-[10px] text-zinc-500 bg-zinc-800 rounded px-1.5 py-0.5">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
              {pattern.tweetUrl && (
                <div>
                  <p className={labelCls}>Source Tweet</p>
                  <a
                    href={pattern.tweetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-sky-400 hover:text-sky-300 underline break-all"
                  >
                    {pattern.tweetUrl}
                  </a>
                </div>
              )}
              <div>
                <p className={labelCls}>Added</p>
                <p className="text-xs text-zinc-500">{new Date(pattern.createdAt).toLocaleDateString()}</p>
              </div>
            </>
          )}
        </div>

        {/* Footer (edit mode only) */}
        {editing && (
          <div className="shrink-0 px-5 py-3 border-t border-zinc-800 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setForm(patternToForm(pattern)); }}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving || !form.name || !form.template}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Pattern card ─────────────────────────────────────────────────────────────

function PatternCard({
  pattern,
  onToggle,
  onDelete,
  onClick,
}: {
  pattern: Pattern;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
  onClick: (p: Pattern) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  async function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    setToggling(true);
    await onToggle(pattern.id, !pattern.isActive);
    setToggling(false);
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete "${pattern.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    await onDelete(pattern.id);
    setDeleting(false);
  }

  const handleLinkClick = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      onClick={() => onClick(pattern)}
      className={cn(
        'rounded-xl border p-4 flex flex-col gap-3 transition-all cursor-pointer',
        'hover:ring-1 hover:ring-zinc-600',
        pattern.isActive ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-800 bg-zinc-950 opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-100 truncate">{pattern.name}</p>
          {pattern.description && (
            <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{pattern.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {pattern.tweetUrl && (
            <a
              href={pattern.tweetUrl}
              target="_blank"
              rel="noreferrer"
              onClick={handleLinkClick}
              className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <ExternalLink size={13} />
            </a>
          )}
          <button
            onClick={handleToggle}
            disabled={toggling}
            className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
            title={pattern.isActive ? 'Deactivate' : 'Activate'}
          >
            {pattern.isActive ? <Power size={13} /> : <PowerOff size={13} />}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1 text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-40"
            title="Delete pattern"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {pattern.contentCategory && (
          <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium leading-none bg-amber-950 text-amber-300">
            {CATEGORY_LABEL[pattern.contentCategory] ?? pattern.contentCategory}
          </span>
        )}
        {pattern.isQrt && (
          <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium leading-none bg-cyan-950 text-cyan-300" title="Requires a tweet to react to">
            QRT
          </span>
        )}
        {pattern.postType && <Chip label={pattern.postType} />}
        {pattern.hookType && <Chip label={pattern.hookType} />}
        {pattern.formatType && <Chip label={pattern.formatType} />}
        {pattern.engagementTarget && <Chip label={pattern.engagementTarget} />}
      </div>

      {pattern.example && (
        <div className="relative rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
          <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed line-clamp-4">
            {pattern.example}
          </p>
          {pattern.template && (
            <span className="absolute bottom-1.5 right-2 text-[9px] text-zinc-600 select-none">
              Click to expand
            </span>
          )}
        </div>
      )}

      {pattern.reusableFor && pattern.reusableFor.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {pattern.reusableFor.slice(0, 6).map(tag => (
            <span key={tag} className="text-[10px] text-zinc-600 bg-zinc-800 rounded px-1.5 py-0.5">
              {tag}
            </span>
          ))}
          {pattern.reusableFor.length > 6 && (
            <span className="text-[10px] text-zinc-700">+{pattern.reusableFor.length - 6}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Add-pattern form fields ──────────────────────────────────────────────────

const EMPTY_FORM = {
  name: '', template: '', description: '', example: '',
  hookType: '', formatType: '', bodyStructure: '', closerType: '',
  engagementTarget: '', coreInsight: '', viralMechanic: '',
  emotionTrigger: '', reusableFor: '', postType: 'tweet',
  contentCategory: '', tweetUrl: '',
};

type FormState = typeof EMPTY_FORM;

// ─── Main client component ────────────────────────────────────────────────────

export function PatternsClient({ initialData }: { initialData: PageData }) {
  const [data, setData] = useState<PageData>(initialData);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);

  const fetchPage = useCallback(async (nextPage: number, search: string, category: string, inactive: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(nextPage) });
      if (search) params.set('q', search);
      if (category) params.set('category', category);
      if (inactive) params.set('inactive', '1');
      const res = await fetch(`/api/admin/patterns?${params}`);
      if (res.ok) {
        const json = await res.json() as PageData;
        setData(json);
        setPage(nextPage);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce search
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { void fetchPage(1, q, activeCategory, showInactive); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [q, activeCategory, showInactive, fetchPage]);

  async function handleToggle(id: string, active: boolean) {
    await fetch('/api/admin/patterns', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isActive: active }),
    });
    setData(prev => ({
      ...prev,
      patterns: prev.patterns.map(p => p.id === id ? { ...p, isActive: active } : p),
    }));
    if (selectedPattern?.id === id) {
      setSelectedPattern(prev => prev ? { ...prev, isActive: active } : null);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/admin/patterns?id=${id}`, { method: 'DELETE' });
    setData(prev => ({
      ...prev,
      total: prev.total - 1,
      patterns: prev.patterns.filter(p => p.id !== id),
    }));
    if (selectedPattern?.id === id) setSelectedPattern(null);
  }

  async function handleAdd() {
    if (!form.name.trim() || !form.template.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        reusableFor: form.reusableFor.split(',').map(s => s.trim()).filter(Boolean),
      };
      const res = await fetch('/api/admin/patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setForm(EMPTY_FORM);
        setShowAdd(false);
        void fetchPage(1, q, activeCategory, showInactive);
      }
    } finally {
      setSaving(false);
    }
  }

  function handlePatternUpdated(updated: Pattern) {
    setData(prev => ({
      ...prev,
      patterns: prev.patterns.map(p => p.id === updated.id ? updated : p),
    }));
    setSelectedPattern(updated);
  }

  function field(key: keyof FormState) {
    return (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }));
  }

  function toggleCategory(slug: string) {
    setActiveCategory(prev => prev === slug ? '' : slug);
  }

  const totalPages = Math.ceil(data.total / data.pageSize);

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      {/* Admin nav */}
      <div className="px-6 pt-5">
        <AdminNav active="patterns" />
      </div>

      {/* Top bar */}
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <p className="text-xs text-zinc-500">{data.total.toLocaleString()} patterns{showInactive ? ' (incl. inactive)' : ' active'}</p>
          <button
            onClick={() => setShowInactive(s => !s)}
            className={cn(
              'text-[11px] rounded-full px-2.5 py-1 border transition-colors',
              showInactive
                ? 'bg-zinc-700 border-zinc-600 text-zinc-200'
                : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300',
            )}
          >
            {showInactive ? 'Hide inactive' : 'Show inactive'}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={q}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
              placeholder="Search by name, hook, format..."
              className="pl-8 w-64 h-8 text-xs bg-zinc-900 border border-zinc-700 rounded-md px-3 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
          </div>
          <Button size="sm" onClick={() => setShowAdd(s => !s)} className="h-8 gap-1.5">
            {showAdd ? <X size={13} /> : <Plus size={13} />}
            {showAdd ? 'Cancel' : 'Add Pattern'}
          </Button>
        </div>
      </div>

      {/* Content category filter bar */}
      <div className="px-6 py-2.5 flex gap-2 overflow-x-auto border-b border-zinc-800 scrollbar-none">
        {CONTENT_CATEGORIES.map(cat => (
          <button
            key={cat.slug}
            onClick={() => toggleCategory(cat.slug)}
            className={cn(
              'shrink-0 text-[11px] rounded-full px-3 py-1 transition-colors border',
              activeCategory === cat.slug
                ? 'bg-amber-950 border-amber-700 text-amber-200'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Hook breakdown pills */}
      <div className="px-6 py-3 flex flex-wrap gap-2 border-b border-zinc-800">
        {data.byHook.map(row => (
          <button
            key={row.hookType ?? 'null'}
            onClick={() => setQ(row.hookType ?? '')}
            className="text-[11px] text-zinc-400 bg-zinc-900 hover:bg-zinc-800 rounded-full px-2.5 py-1 transition-colors"
          >
            {row.hookType ?? 'unknown'} <span className="text-zinc-600 ml-1">{row.count}</span>
          </button>
        ))}
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="mx-6 mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-6">
          <h2 className="text-sm font-semibold mb-4">New Pattern</h2>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className={labelCls}>Name *</label>
              <input value={form.name} onChange={field('name')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Hook Type</label>
              <input value={form.hookType} onChange={field('hookType')} placeholder="contrarian, story, stat..." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Format Type</label>
              <input value={form.formatType} onChange={field('formatType')} placeholder="single-punch, numbered-list..." className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className={labelCls}>Post Type</label>
              <input value={form.postType} onChange={field('postType')} placeholder="tweet / thread / long-post" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Content Category</label>
              <select value={form.contentCategory} onChange={field('contentCategory')} className={inputCls}>
                <option value="">- none -</option>
                {CONTENT_CATEGORIES.map(c => (
                  <option key={c.slug} value={c.slug}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Engagement Target</label>
              <input value={form.engagementTarget} onChange={field('engagementTarget')} placeholder="save, share, reply..." className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={labelCls}>Emotion Trigger</label>
              <input value={form.emotionTrigger} onChange={field('emotionTrigger')} placeholder="curiosity, aspiration..." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <input value={form.description} onChange={field('description')} className={inputCls} />
            </div>
          </div>
          <div className="mb-3">
            <label className={labelCls}>Template (blueprint with [brackets]) *</label>
            <textarea value={form.template} onChange={field('template')} rows={4} className={textareaCls} />
          </div>
          <div className="mb-3">
            <label className={labelCls}>Example Post (real viral tweet using this structure)</label>
            <textarea value={form.example} onChange={field('example')} rows={4} className={textareaCls} />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={labelCls}>Reusable For (comma-separated tags)</label>
              <input value={form.reusableFor} onChange={field('reusableFor')} placeholder="startups, marketing, saas..." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Source Tweet URL</label>
              <input value={form.tweetUrl} onChange={field('tweetUrl')} placeholder="https://x.com/..." className={inputCls} />
            </div>
          </div>
          <div className="mb-4">
            <label className={labelCls}>Core Insight (why this works)</label>
            <input value={form.coreInsight} onChange={field('coreInsight')} className={inputCls} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button size="sm" onClick={() => void handleAdd()} disabled={saving || !form.name || !form.template}>
              {saving ? 'Saving...' : 'Save Pattern'}
            </Button>
          </div>
        </div>
      )}

      {/* Grid */}
      <div className={cn('px-6 py-6 transition-opacity', loading && 'opacity-50 pointer-events-none')}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.patterns.map(p => (
            <PatternCard
              key={p.id}
              pattern={p}
              onToggle={(id, active) => void handleToggle(id, active)}
              onDelete={(id) => void handleDelete(id)}
              onClick={setSelectedPattern}
            />
          ))}
        </div>
        {data.patterns.length === 0 && (
          <p className="text-center text-zinc-600 py-16 text-sm">No patterns found.</p>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-6 pb-8 flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchPage(page - 1, q, activeCategory, showInactive)}
            disabled={page <= 1 || loading}
            className="h-8 gap-1"
          >
            <ChevronLeft size={13} /> Prev
          </Button>
          <span className="text-xs text-zinc-500">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchPage(page + 1, q, activeCategory, showInactive)}
            disabled={page >= totalPages || loading}
            className="h-8 gap-1"
          >
            Next <ChevronRight size={13} />
          </Button>
        </div>
      )}

      {/* Detail slide-over */}
      {selectedPattern && (
        <DetailPanel
          pattern={selectedPattern}
          onClose={() => setSelectedPattern(null)}
          onUpdated={handlePatternUpdated}
        />
      )}
    </div>
  );
}
