'use client';

import { useState } from 'react';
import { Plus, Trash2, Power, PowerOff, Pencil, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AdminNav } from '@/components/admin/users-client';

export interface VisualInspiration {
  id: string;
  name: string;
  stylePrompt: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

const CATEGORIES = [
  { slug: 'diagram',      label: 'Diagram',      color: 'text-blue-400' },
  { slug: 'list',         label: 'List',         color: 'text-green-400' },
  { slug: 'chart',        label: 'Chart',        color: 'text-yellow-400' },
  { slug: 'branding',     label: 'Branding',     color: 'text-purple-400' },
  { slug: 'illustration', label: 'Illustration', color: 'text-orange-400' },
  { slug: 'image',        label: 'Image',        color: 'text-pink-400' },
];

const categoryColor = (cat: string) => CATEGORIES.find(c => c.slug === cat)?.color ?? 'text-muted-foreground';
const categoryLabel = (cat: string) => CATEGORIES.find(c => c.slug === cat)?.label ?? cat;

interface AddFormState {
  name: string;
  stylePrompt: string;
  category: string;
}

interface EditState {
  id: string;
  name: string;
  stylePrompt: string;
  category: string;
}

export function VisualsClient({ initial }: { initial: VisualInspiration[] }) {
  const [items, setItems] = useState<VisualInspiration[]>(initial);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AddFormState>({ name: '', stylePrompt: '', category: 'diagram' });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);

  async function handleAdd() {
    if (!form.name.trim() || !form.stylePrompt.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/visual-inspirations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const row = await res.json() as VisualInspiration;
        setItems(prev => [...prev, { ...row, createdAt: row.createdAt }]);
        setForm({ name: '', stylePrompt: '', category: 'diagram' });
        setShowAdd(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string, isActive: boolean) {
    const res = await fetch(`/api/admin/visual-inspirations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    });
    if (res.ok) {
      setItems(prev => prev.map(i => i.id === id ? { ...i, isActive: !isActive } : i));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this visual inspiration?')) return;
    const res = await fetch(`/api/admin/visual-inspirations/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setItems(prev => prev.filter(i => i.id !== id));
    }
  }

  async function handleSaveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/visual-inspirations/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editing.name, stylePrompt: editing.stylePrompt, category: editing.category }),
      });
      if (res.ok) {
        const row = await res.json() as VisualInspiration;
        setItems(prev => prev.map(i => i.id === row.id ? row : i));
        setEditing(null);
      }
    } finally {
      setSaving(false);
    }
  }

  const activeCount = items.filter(i => i.isActive).length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <AdminNav active="visuals" />

      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-muted-foreground">{items.length} styles · {activeCount} active · 2 random injected per image gen</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(v => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Style
        </Button>
      </div>

      {showAdd && (
        <div className="border border-border rounded-lg p-4 mb-6 space-y-3 bg-muted/30">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Name</label>
              <input
                className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm"
                placeholder="e.g. Dark X-diagram"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Category</label>
              <select
                className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              >
                {CATEGORIES.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Style Description</label>
            <textarea
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm resize-none font-mono"
              rows={7}
              placeholder={`When: [what post type / context this fits]\nVisual: [background, colors, layout, typography, mood]\nExample prompt: "[short sample image gen prompt in quotes]"`}
              value={form.stylePrompt}
              onChange={e => setForm(f => ({ ...f, stylePrompt: e.target.value }))}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAdd} disabled={saving || !form.name.trim() || !form.stylePrompt.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12">No visual inspirations yet. Add your first one above.</p>
        )}
        {items.map(item => (
          <div
            key={item.id}
            className={cn(
              'border border-border rounded-lg p-4',
              !item.isActive && 'opacity-50',
            )}
          >
            {editing?.id === item.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    className="bg-background border border-border rounded px-3 py-1.5 text-sm"
                    value={editing.name}
                    onChange={e => setEditing(s => s && ({ ...s, name: e.target.value }))}
                  />
                  <select
                    className="bg-background border border-border rounded px-3 py-1.5 text-sm"
                    value={editing.category}
                    onChange={e => setEditing(s => s && ({ ...s, category: e.target.value }))}
                  >
                    {CATEGORIES.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
                  </select>
                </div>
                <textarea
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm resize-none"
                  rows={4}
                  value={editing.stylePrompt}
                  onChange={e => setEditing(s => s && ({ ...s, stylePrompt: e.target.value }))}
                />
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}><X className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" onClick={handleSaveEdit} disabled={saving}><Check className="h-3.5 w-3.5 mr-1" />{saving ? 'Saving...' : 'Save'}</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{item.name}</span>
                    <span className={cn('text-xs font-medium', categoryColor(item.category))}>{categoryLabel(item.category)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{item.stylePrompt}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setEditing({ id: item.id, name: item.name, stylePrompt: item.stylePrompt, category: item.category })}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => handleToggle(item.id, item.isActive)}
                    title={item.isActive ? 'Disable' : 'Enable'}
                  >
                    {item.isActive ? <Power className="h-3.5 w-3.5 text-green-500" /> : <PowerOff className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(item.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
