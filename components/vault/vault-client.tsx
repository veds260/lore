'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { FileText, ImageIcon, Loader2, RefreshCw, Trash2, Upload, Wand2, X, Search } from 'lucide-react';

type VaultNote = {
  id: string;
  title: string;
  type: string;
  tags: string[] | null;
  topics: string[] | null;
  summary: string | null;
  source: string;
  status: string;
  updatedAt: string;
};

type VaultAsset = {
  id: string;
  originalFilename: string;
  fileUrl: string;
  thumbnailUrl: string | null;
  tags: string[] | null;
  topics: string[] | null;
  usableFor: string[] | null;
  doNotUseFor: string[] | null;
  visualStyle: string | null;
  sensitivity: string;
  captionSummary: string | null;
  status: string;
  createdAt: string;
};

interface VaultClientProps {
  initialNotes: VaultNote[];
  initialAssets: VaultAsset[];
  globalRulesCount: number;
  mirrorSummary: { skills: number; corrections: number; voiceDoc: number } | null;
}

const NOTE_TYPES = ['rule', 'idea', 'story', 'proof', 'belief', 'profile'] as const;
const VISUAL_STATUSES = ['all', 'ready', 'processing', 'analyzing', 'needs_review', 'failed'] as const;
const SENSITIVITIES = ['safe', 'private', 'client-confidential', 'needs_review'] as const;

function csvToList(value: string) {
  return value.split(',').map(v => v.trim()).filter(Boolean);
}

function listToCsv(value: string[] | null | undefined) {
  return (value ?? []).join(', ');
}

function noteMatches(note: VaultNote, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    note.title,
    note.type,
    note.source,
    note.status,
    note.summary ?? '',
    ...(note.tags ?? []),
    ...(note.topics ?? []),
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

function filterNotes(notes: VaultNote[], query: string, type: string, source: string, status: string): VaultNote[] {
  return notes.filter(note =>
    noteMatches(note, query) &&
    (type === 'all' || note.type === type) &&
    (source === 'all' || note.source === source) &&
    (status === 'all' || note.status === status),
  );
}

export function VaultClient({ initialNotes, initialAssets, globalRulesCount, mirrorSummary }: VaultClientProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [assets, setAssets] = useState(initialAssets);
  const [tab, setTab] = useState<'rules' | 'notes' | 'visuals'>('rules');
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [visualStatus, setVisualStatus] = useState<typeof VISUAL_STATUSES[number]>('all');
  const [noteQuery, setNoteQuery] = useState('');
  const [noteTypeFilter, setNoteTypeFilter] = useState('all');
  const [noteSourceFilter, setNoteSourceFilter] = useState('all');
  const [noteStatusFilter, setNoteStatusFilter] = useState('all');
  const [uploadMessage, setUploadMessage] = useState('');
  const [editingAsset, setEditingAsset] = useState<VaultAsset | null>(null);
  const [assetDraft, setAssetDraft] = useState({
    captionSummary: '',
    visualStyle: '',
    sensitivity: 'safe',
    status: 'ready',
    tags: '',
    topics: '',
    usableFor: '',
    doNotUseFor: '',
  });
  const [savingAsset, setSavingAsset] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [newNote, setNewNote] = useState({ title: '', type: 'idea', tags: '', body: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  const ruleNotes = useMemo(() => notes.filter(n => n.type === 'rule'), [notes]);
  const nonRuleNotes = useMemo(() => notes.filter(n => n.type !== 'rule' && n.type !== 'visual'), [notes]);
  const noteSources = useMemo(() => Array.from(new Set(notes.map(n => n.source).filter(Boolean))).sort(), [notes]);
  const filteredRuleNotes = useMemo(() => filterNotes(ruleNotes, noteQuery, noteTypeFilter, noteSourceFilter, noteStatusFilter), [ruleNotes, noteQuery, noteTypeFilter, noteSourceFilter, noteStatusFilter]);
  const filteredNonRuleNotes = useMemo(() => filterNotes(nonRuleNotes, noteQuery, noteTypeFilter, noteSourceFilter, noteStatusFilter), [nonRuleNotes, noteQuery, noteTypeFilter, noteSourceFilter, noteStatusFilter]);
  const recentLearningNotes = useMemo(() => ruleNotes.filter(n => n.source === 'agent_memory' || n.tags?.includes('corrections') || n.tags?.includes('memory')).slice(0, 3), [ruleNotes]);
  const readyAssets = useMemo(() => assets.filter(a => a.status === 'ready'), [assets]);
  const needsReviewAssets = useMemo(() => assets.filter(a => a.status === 'needs_review' || a.sensitivity === 'needs_review'), [assets]);
  const visibleAssets = useMemo(() => (
    visualStatus === 'all' ? assets : assets.filter(a => a.status === visualStatus)
  ), [assets, visualStatus]);

  async function refresh() {
    const [notesRes, assetsRes] = await Promise.all([
      fetch('/api/vault/notes'),
      fetch('/api/vault/assets'),
    ]);
    if (notesRes.ok) setNotes(((await notesRes.json()) as { notes: VaultNote[] }).notes);
    if (assetsRes.ok) setAssets(((await assetsRes.json()) as { assets: VaultAsset[] }).assets);
  }

  async function syncLearning() {
    setSyncing(true);
    try {
      await fetch('/api/vault/sync', { method: 'POST' });
      await refresh();
    } finally {
      setSyncing(false);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(files).forEach(file => form.append('files', file));
      form.append('source', 'vault-ui');
      const count = files.length;
      setUploadMessage(`Uploading ${count} visual${count === 1 ? '' : 's'}...`);
      await fetch('/api/vault/assets/upload', { method: 'POST', body: form });
      setUploadMessage(`Uploaded ${count} visual${count === 1 ? '' : 's'}. Analysis may keep running briefly.`);
      await refresh();
      window.setTimeout(() => { refresh().catch(() => {}); }, 2500);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
      window.setTimeout(() => setUploadMessage(''), 5000);
    }
  }

  async function createNote() {
    if (!newNote.title.trim()) return;
    const tags = newNote.tags.split(',').map(t => t.trim()).filter(Boolean);
    const res = await fetch('/api/vault/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newNote.title,
        type: newNote.type,
        tags,
        topics: tags,
        summary: newNote.body.slice(0, 220),
        body: newNote.body,
      }),
    });
    if (res.ok) {
      setNewNote({ title: '', type: 'idea', tags: '', body: '' });
      await refresh();
    }
  }

  function openAssetEditor(asset: VaultAsset) {
    setEditingAsset(asset);
    setAssetDraft({
      captionSummary: asset.captionSummary ?? '',
      visualStyle: asset.visualStyle ?? '',
      sensitivity: asset.sensitivity,
      status: asset.status,
      tags: listToCsv(asset.tags),
      topics: listToCsv(asset.topics),
      usableFor: listToCsv(asset.usableFor),
      doNotUseFor: listToCsv(asset.doNotUseFor),
    });
  }

  async function saveAsset() {
    if (!editingAsset) return;
    setSavingAsset(true);
    try {
      const res = await fetch(`/api/vault/assets/${editingAsset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          captionSummary: assetDraft.captionSummary,
          visualStyle: assetDraft.visualStyle,
          sensitivity: assetDraft.sensitivity,
          status: assetDraft.status,
          tags: csvToList(assetDraft.tags),
          topics: csvToList(assetDraft.topics),
          usableFor: csvToList(assetDraft.usableFor),
          doNotUseFor: csvToList(assetDraft.doNotUseFor),
        }),
      });
      if (res.ok) {
        setEditingAsset(null);
        await refresh();
      }
    } finally {
      setSavingAsset(false);
    }
  }

  async function deleteAsset(asset: VaultAsset) {
    if (!confirm(`Delete ${asset.originalFilename}?`)) return;
    const res = await fetch(`/api/vault/assets/${asset.id}`, { method: 'DELETE' });
    if (res.ok) await refresh();
  }

  return (
    <div className="p-8 lg:p-10 w-full max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Obsidian powered memory</p>
          <h1 className="text-2xl font-semibold tracking-tight">Vault</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Global rules, tenant rules, self-learning notes, and visual assets that Lore can pull into posts.
          </p>
        </div>
        <button
          onClick={syncLearning}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-accent disabled:opacity-50"
        >
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Sync learning
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
        <Metric label="Global rules" value={globalRulesCount} />
        <Metric label="Tenant rules" value={ruleNotes.length} />
        <Metric label="Vault notes" value={nonRuleNotes.length} />
        <Metric label="Ready visuals" value={readyAssets.length} />
        <button
          onClick={() => { setTab('visuals'); setVisualStatus('needs_review'); }}
          className="rounded-lg border border-border bg-card p-4 text-left hover:bg-accent"
        >
          <div className="text-2xl font-semibold">{needsReviewAssets.length}</div>
          <div className="text-xs text-muted-foreground mt-1">Needs review</div>
        </button>
      </div>

      {mirrorSummary && (
        <div className="mb-6 rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          Last mirror pulled {mirrorSummary.skills} skills, {mirrorSummary.corrections} corrections, and {mirrorSummary.voiceDoc} voice document into the tenant vault.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-5">
        {(['rules', 'notes', 'visuals'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-xs capitalize transition-colors ${tab === t ? 'bg-foreground text-background' : 'bg-card border border-border text-muted-foreground hover:text-foreground'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab !== 'visuals' && (
        <div className="mb-5 grid grid-cols-1 gap-2 rounded-xl border border-border bg-card p-3 md:grid-cols-[1fr_150px_150px_150px]">
          <label className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm"
              placeholder="Search notes, tags, sources..."
              value={noteQuery}
              onChange={e => setNoteQuery(e.target.value)}
            />
          </label>
          <select className="rounded-md border border-border bg-background px-3 py-2 text-xs" value={noteTypeFilter} onChange={e => setNoteTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            {NOTE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="rounded-md border border-border bg-background px-3 py-2 text-xs" value={noteSourceFilter} onChange={e => setNoteSourceFilter(e.target.value)}>
            <option value="all">All sources</option>
            {noteSources.map(source => <option key={source} value={source}>{source}</option>)}
          </select>
          <select className="rounded-md border border-border bg-background px-3 py-2 text-xs" value={noteStatusFilter} onChange={e => setNoteStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">active</option>
            <option value="needs_review">needs review</option>
            <option value="archived">archived</option>
          </select>
        </div>
      )}

      {tab === 'rules' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {recentLearningNotes.length > 0 && (
            <div className="lg:col-span-2 rounded-xl border border-[#529E63]/30 bg-[#529E63]/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#529E63]">Recent learning</p>
              <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
                {recentLearningNotes.map(note => <NoteCard key={note.id} note={note} />)}
              </div>
            </div>
          )}
          {filteredRuleNotes.map(note => <NoteCard key={note.id} note={note} />)}
          {filteredRuleNotes.length === 0 && <EmptyPanel icon={<Wand2 size={18} />} text="No tenant rules match these filters. Sync learning or clear filters." />}
        </div>
      )}

      {tab === 'notes' && (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5">
          <div className="rounded-xl border border-border bg-card p-4 h-fit">
            <h2 className="text-sm font-medium mb-3">Add a vault note</h2>
            <input className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm mb-2" placeholder="Title" value={newNote.title} onChange={e => setNewNote(v => ({ ...v, title: e.target.value }))} />
            <select className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm mb-2" value={newNote.type} onChange={e => setNewNote(v => ({ ...v, type: e.target.value }))}>
              {NOTE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm mb-2" placeholder="tags, comma separated" value={newNote.tags} onChange={e => setNewNote(v => ({ ...v, tags: e.target.value }))} />
            <textarea className="w-full min-h-32 bg-background border border-border rounded-md px-3 py-2 text-sm mb-3" placeholder="What should Lore remember?" value={newNote.body} onChange={e => setNewNote(v => ({ ...v, body: e.target.value }))} />
            <button onClick={createNote} className="w-full rounded-md bg-foreground text-background px-3 py-2 text-xs font-medium">Add to vault</button>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {filteredNonRuleNotes.map(note => <NoteCard key={note.id} note={note} />)}
            {filteredNonRuleNotes.length === 0 && <EmptyPanel icon={<FileText size={18} />} text="No notes match these filters. Add stories, proof, beliefs, or ideas for Lore to pull from." />}
          </div>
        </div>
      )}

      {tab === 'visuals' && (
        <div>
          <div
            className={`rounded-xl border border-dashed p-6 mb-5 transition-colors ${dragging ? 'border-foreground bg-accent' : 'border-border bg-card'}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault();
              setDragging(false);
              uploadFiles(e.dataTransfer.files).catch(() => {});
            }}
          >
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => uploadFiles(e.target.files)} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-4 py-2 text-sm disabled:opacity-50">
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              Upload visuals
            </button>
            <p className="text-xs text-muted-foreground mt-3">
              Drag images here or pick multiple files. Lore stores them, creates visual notes, tags them, and can attach the best fit to posts.
            </p>
            {uploadMessage && <p className="mt-2 text-xs text-[#529E63]">{uploadMessage}</p>}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            {VISUAL_STATUSES.map(status => (
              <button
                key={status}
                onClick={() => setVisualStatus(status)}
                className={`rounded-md px-2.5 py-1.5 text-[11px] capitalize transition-colors ${visualStatus === status ? 'bg-foreground text-background' : 'border border-border bg-card text-muted-foreground hover:text-foreground'}`}
              >
                {status.replace('_', ' ')}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleAssets.map(asset => <AssetCard key={asset.id} asset={asset} onEdit={openAssetEditor} onDelete={deleteAsset} />)}
            {visibleAssets.length === 0 && <EmptyPanel icon={<ImageIcon size={18} />} text="No visuals match this filter yet. Upload screenshots, photos, charts, memes, or product shots." />}
          </div>
        </div>
      )}

      {editingAsset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setEditingAsset(null)}
        >
          <div
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-medium">Edit asset</h2>
                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{editingAsset.originalFilename}</p>
              </div>
              <button onClick={() => setEditingAsset(null)} className="text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <Field label="Caption summary">
                <textarea
                  className="w-full min-h-20 bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={assetDraft.captionSummary}
                  onChange={e => setAssetDraft(v => ({ ...v, captionSummary: e.target.value }))}
                />
              </Field>
              <Field label="Visual style">
                <input
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={assetDraft.visualStyle}
                  onChange={e => setAssetDraft(v => ({ ...v, visualStyle: e.target.value }))}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Sensitivity">
                  <select
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                    value={assetDraft.sensitivity}
                    onChange={e => setAssetDraft(v => ({ ...v, sensitivity: e.target.value }))}
                  >
                    {SENSITIVITIES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                    value={assetDraft.status}
                    onChange={e => setAssetDraft(v => ({ ...v, status: e.target.value }))}
                  >
                    {VISUAL_STATUSES.filter(s => s !== 'all').map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Tags (comma separated)">
                <input
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={assetDraft.tags}
                  onChange={e => setAssetDraft(v => ({ ...v, tags: e.target.value }))}
                />
              </Field>
              <Field label="Topics (comma separated)">
                <input
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={assetDraft.topics}
                  onChange={e => setAssetDraft(v => ({ ...v, topics: e.target.value }))}
                />
              </Field>
              <Field label="Usable for (comma separated)">
                <input
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={assetDraft.usableFor}
                  onChange={e => setAssetDraft(v => ({ ...v, usableFor: e.target.value }))}
                />
              </Field>
              <Field label="Do not use for (comma separated)">
                <input
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={assetDraft.doNotUseFor}
                  onChange={e => setAssetDraft(v => ({ ...v, doNotUseFor: e.target.value }))}
                />
              </Field>
            </div>

            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                onClick={() => setEditingAsset(null)}
                className="rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={saveAsset}
                disabled={savingAsset}
                className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-3 py-2 text-xs font-medium disabled:opacity-50"
              >
                {savingAsset && <Loader2 size={13} className="animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function NoteCard({ note }: { note: VaultNote }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{note.type}</span>
        <span className="text-[10px] text-muted-foreground">{note.source}</span>
      </div>
      <h3 className="text-sm font-medium mb-2">{note.title}</h3>
      {note.summary && <p className="text-xs text-muted-foreground leading-relaxed mb-3">{note.summary}</p>}
      <TagRow tags={[...(note.tags ?? []), ...(note.topics ?? [])].slice(0, 8)} />
    </div>
  );
}

function AssetCard({ asset, onEdit, onDelete }: { asset: VaultAsset; onEdit: (asset: VaultAsset) => void; onDelete: (asset: VaultAsset) => void }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="aspect-video bg-muted">
        <img src={asset.thumbnailUrl ?? asset.fileUrl} alt={asset.originalFilename} className="h-full w-full object-cover" />
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 className="text-sm font-medium truncate">{asset.originalFilename}</h3>
          <span className="text-[10px] rounded-full border border-border px-2 py-0.5 text-muted-foreground">{asset.status}</span>
        </div>
        {asset.captionSummary && <p className="text-xs text-muted-foreground leading-relaxed mb-3">{asset.captionSummary}</p>}
        <div className="text-[11px] text-muted-foreground mb-2">{asset.visualStyle ?? 'visual'} · {asset.sensitivity}</div>
        <TagRow tags={[...(asset.tags ?? []), ...(asset.topics ?? [])].slice(0, 10)} />
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => onEdit(asset)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] hover:bg-accent"
          >
            <Wand2 size={12} /> Edit
          </button>
          <button
            onClick={() => onDelete(asset)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function TagRow({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map(tag => <span key={tag} className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span>)}
    </div>
  );
}

function EmptyPanel({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
      <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-muted-foreground">{icon}</div>
      {text}
    </div>
  );
}
