'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Loader2, X, Plus, Edit2, Check, Sparkles, Upload, Settings as SettingsIcon, Brain, ArrowUpRight } from 'lucide-react';

interface BannedPhrase {
  id: string;
  name: string;
  body: string;
  source: string;
  isInferred: boolean;
  createdAt: string;
}

export interface ProfileData {
  id: string;
  name: string;
  handle: string | null;
  linkedinHandle: string | null;
  niche: string | null;
  voiceSummary: string | null;
  contentStyle: string;
  contentPillars: string[];
  weeklyFocus: string | null;
  brief: {
    whatYouDo: string;
    audience: string;
    positioning: string;
    background: string;
    recentWin: string;
    strongBelief: string;
  };
  bannedPhrases: BannedPhrase[];
}

interface SectionProps {
  title: string;
  id?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ title, id, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div id={id} className="border border-border rounded-lg bg-card scroll-mt-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/30 transition-colors"
      >
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <ChevronDown size={14} className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border">{children}</div>}
    </div>
  );
}

interface EditableFieldProps {
  label: string;
  value: string;
  multiline?: boolean;
  inferred?: boolean;
  source?: string;
  onSave: (v: string) => Promise<void>;
}

function EditableField({ label, value, multiline = false, inferred = false, source, onSave }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  async function commit() {
    if (draft.trim() === value.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    await onSave(draft.trim());
    setSaving(false);
    setEditing(false);
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {inferred && (
          <span
            className="text-[10px] text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20"
            title={source ? `Inferred from ${source}` : 'Inferred by AI. Confirm or edit'}
          >
            inferred
          </span>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          {multiline ? (
            <textarea
              autoFocus
              rows={3}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-md bg-card text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          ) : (
            <input
              autoFocus
              type="text"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !multiline) commit(); if (e.key === 'Escape') setEditing(false); }}
              className="w-full px-3 py-2 border border-border rounded-md bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={commit}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-foreground text-background rounded-md font-medium hover:opacity-90 disabled:opacity-40"
            >
              {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
              Save
            </button>
            <button
              onClick={() => { setDraft(value); setEditing(false); }}
              className="text-xs px-2.5 py-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="w-full text-left group flex items-start gap-2"
        >
          <p className={`flex-1 text-sm text-foreground leading-relaxed whitespace-pre-wrap ${
            !value ? 'text-muted-foreground italic' : ''
          } ${
            inferred && value ? 'underline decoration-dotted decoration-amber-500/40 underline-offset-4' : ''
          }`}>
            {value || `Click to add ${label.toLowerCase()}…`}
          </p>
          <Edit2 size={11} className="opacity-0 group-hover:opacity-100 text-muted-foreground transition-opacity shrink-0 mt-1" />
        </button>
      )}
    </div>
  );
}

export function ProfileClient({ initial }: { initial: ProfileData }) {
  const [data, setData] = useState<ProfileData>(initial);
  const [newPhrase, setNewPhrase] = useState('');
  const [adding, setAdding] = useState(false);
  // Upload-more inline panel state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadText, setUploadText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadResult, setUploadResult] = useState<string[] | null>(null);

  async function patchProfile(patch: Record<string, unknown>) {
    const res = await fetch('/api/profile/full', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('Save failed');
  }

  async function patchBrief(field: keyof ProfileData['brief'], value: string) {
    const newBrief = { ...data.brief, [field]: value };
    setData(d => ({ ...d, brief: newBrief }));
    await patchProfile({ brief: newBrief });
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setUploadText(text);
      await runAugment(text);
    } catch {
      setUploadError('Could not read that file.');
    } finally {
      if (e.target) e.target.value = '';
    }
  }

  async function runAugment(markdown: string) {
    if (markdown.trim().length < 20) {
      setUploadError('Add at least a few sentences before uploading.');
      return;
    }
    setUploading(true);
    setUploadError('');
    setUploadResult(null);
    try {
      const res = await fetch('/api/profile/augment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      });
      const out = await res.json() as { ok?: boolean; learned?: string[]; message?: string; error?: string };
      if (!res.ok) {
        setUploadError(out.error ?? 'Upload failed');
        return;
      }
      setUploadResult(out.learned ?? []);
      // Refresh the profile from server so any niche/voice/pillars updates land
      try {
        const fresh = await fetch('/api/profile/full');
        if (fresh.ok) {
          const next = (await fresh.json()) as ProfileData;
          setData(next);
        }
      } catch {}
      setUploadText('');
    } catch {
      setUploadError('Something went wrong. Try again.');
    } finally {
      setUploading(false);
    }
  }

  async function addPhrase() {
    const phrase = newPhrase.trim();
    if (!phrase) return;
    setAdding(true);
    try {
      const res = await fetch('/api/profile/banned-phrases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase }),
      });
      if (res.ok) {
        const r = await res.json();
        setData(d => ({
          ...d,
          bannedPhrases: [{
            id: r.id,
            name: `Avoid: ${phrase}`,
            body: r.body,
            source: 'manual',
            isInferred: false,
            createdAt: new Date().toISOString(),
          }, ...d.bannedPhrases],
        }));
        setNewPhrase('');
      }
    } finally {
      setAdding(false);
    }
  }

  async function removePhrase(id: string) {
    setData(d => ({ ...d, bannedPhrases: d.bannedPhrases.filter(p => p.id !== id) }));
    await fetch(`/api/profile/banned-phrases?id=${id}`, { method: 'DELETE' });
  }

  return (
    <div className="p-8 lg:p-10 max-w-3xl mx-auto w-full space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everything Lore knows about you. Edit anything, inferred fields are marked.
        </p>
      </div>

      {/* CV-style summary card */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="mb-3">
          <p className="text-lg font-semibold text-foreground leading-tight">{data.name}</p>
          {data.niche && <p className="text-sm text-muted-foreground mt-0.5">{data.niche}</p>}
        </div>

        {data.voiceSummary && (
          <p className="text-sm text-foreground leading-relaxed mb-4">{data.voiceSummary}</p>
        )}

        {data.contentPillars.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {data.contentPillars.map((p, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{p}</span>
            ))}
          </div>
        )}

        {/* 3 action buttons: upload more / edit info / edit voice */}
        <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
          <button
            onClick={() => { setUploadOpen(o => !o); setUploadResult(null); setUploadError(''); }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity"
          >
            <Upload size={11} />
            {uploadOpen ? 'Close upload' : 'Upload more'}
          </button>
          <a
            href="#voice-tone"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-md text-foreground hover:bg-accent transition-colors"
          >
            <Edit2 size={11} />
            Edit voice
          </a>
          <a
            href="#background"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-md text-foreground hover:bg-accent transition-colors"
          >
            <Edit2 size={11} />
            Edit info
          </a>
          <Link
            href="/settings"
            className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <SettingsIcon size={11} />
            Settings
          </Link>
        </div>

        {/* Upload-more inline panel, merges new context into the current brand */}
        {uploadOpen && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-sm font-medium text-foreground mb-1">Add more context</p>
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
              Drop a file (markdown, text, ChatGPT export) or paste anything that adds to who you are: a new bio, a podcast transcript, a blog post, a case study. Lore reads it and updates this profile. Does not replace anything; only adds.
            </p>

            <textarea
              value={uploadText}
              onChange={e => setUploadText(e.target.value)}
              rows={5}
              placeholder="Paste a bio, transcript, or any text about you…"
              className="w-full px-3 py-2.5 border border-border rounded-md bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none leading-relaxed mb-2"
            />

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-md text-foreground hover:bg-accent transition-colors cursor-pointer">
                <Upload size={11} />
                Upload a file
                <input type="file" accept=".md,.txt,.json" className="hidden" onChange={handleUploadFile} />
              </label>
              <button
                onClick={() => runAugment(uploadText)}
                disabled={uploading || uploadText.trim().length < 20}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {uploading ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                {uploading ? 'Reading…' : 'Add to my profile'}
              </button>
              <span className="text-[11px] text-muted-foreground">
                Minimum 20 characters.
              </span>
            </div>

            {uploadError && (
              <p className="mt-3 text-xs text-destructive">{uploadError}</p>
            )}

            {uploadResult && uploadResult.length > 0 && (
              <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-400">
                Added: {uploadResult.join(', ')}.
              </p>
            )}
            {uploadResult && uploadResult.length === 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Nothing new to add from that. Try a longer or more specific document.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Voice & Tone */}
      <Section id="voice-tone" title="Voice & Tone">
        <EditableField
          label="Voice summary"
          value={data.voiceSummary ?? ''}
          multiline
          inferred
          source="onboarding"
          onSave={async v => {
            setData(d => ({ ...d, voiceSummary: v }));
            await patchProfile({ voiceSummary: v });
          }}
        />
        <EditableField
          label="Niche"
          value={data.niche ?? ''}
          inferred
          source="onboarding"
          onSave={async v => {
            setData(d => ({ ...d, niche: v }));
            await patchProfile({ niche: v });
          }}
        />
        <EditableField
          label="Current focus"
          value={data.weeklyFocus ?? ''}
          multiline
          onSave={async v => {
            setData(d => ({ ...d, weeklyFocus: v }));
            await patchProfile({ weeklyFocus: v });
          }}
        />
      </Section>

      {/* Background & Wins */}
      <Section id="background" title="Background & Wins">
        <EditableField
          label="What you do"
          value={data.brief.whatYouDo}
          multiline
          onSave={v => patchBrief('whatYouDo', v)}
        />
        <EditableField
          label="Background"
          value={data.brief.background}
          multiline
          onSave={v => patchBrief('background', v)}
        />
        <EditableField
          label="Recent win"
          value={data.brief.recentWin}
          multiline
          onSave={v => patchBrief('recentWin', v)}
        />
      </Section>

      {/* Beliefs & Audience */}
      <Section id="beliefs" title="Beliefs & Audience">
        <EditableField
          label="Target audience"
          value={data.brief.audience}
          multiline
          onSave={v => patchBrief('audience', v)}
        />
        <EditableField
          label="Unique angle / positioning"
          value={data.brief.positioning}
          multiline
          onSave={v => patchBrief('positioning', v)}
        />
        <EditableField
          label="Strong belief / contrarian take"
          value={data.brief.strongBelief}
          multiline
          onSave={v => patchBrief('strongBelief', v)}
        />
      </Section>

      {/* Banned Phrases */}
      <Section title="Banned phrases">
        <p className="text-xs text-muted-foreground -mt-1 leading-relaxed">
          Words and patterns Lore will never use in your posts. Add anything that doesn&apos;t sound like you.
        </p>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. compound, leverage, distribution beats production"
            value={newPhrase}
            onChange={e => setNewPhrase(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addPhrase(); }}
            className="flex-1 px-3 py-2 border border-border rounded-md bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={addPhrase}
            disabled={adding || !newPhrase.trim()}
            className="flex items-center gap-1.5 text-xs px-3 py-2 bg-foreground text-background rounded-md font-medium hover:opacity-90 disabled:opacity-40"
          >
            {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
            Add
          </button>
        </div>

        {data.bannedPhrases.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No phrases banned yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.bannedPhrases.map(p => {
              const phrase = p.name.replace(/^Avoid:\s*/i, '');
              return (
                <span
                  key={p.id}
                  className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border ${
                    p.isInferred
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                      : 'border-border bg-muted text-foreground'
                  }`}
                  title={p.body}
                >
                  {p.isInferred && <Sparkles size={9} />}
                  {phrase}
                  <button
                    onClick={() => removePhrase(p.id)}
                    className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors"
                    aria-label="Remove"
                  >
                    <X size={10} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
