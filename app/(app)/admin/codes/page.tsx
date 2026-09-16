'use client';

import { useState, useEffect } from 'react';
import { AdminNav } from '@/components/admin/users-client';
import { Loader2, Copy, CheckCheck } from 'lucide-react';

interface InviteCode {
  id: string;
  code: string;
  planTier: string;
  note: string | null;
  redeemedBy: string | null;
  redeemedAt: string | null;
  redeemedByEmail: string | null;
  redeemedByName: string | null;
  expiresAt: string | null;
  createdAt: string;
}

const PLAN_LABELS: Record<string, string> = {
  pro: 'Pro',
  growth: 'Growth',
  agency: 'Agency',
};

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `LORE-${part()}`;
}

export default function AdminCodesPage() {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const [form, setForm] = useState({
    code: generateCode(),
    planTier: 'pro',
    note: '',
  });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/invite-codes');
      if (res.ok) setCodes(await res.json() as InviteCode[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { Promise.resolve().then(() => load()); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/admin/invite-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: form.code.trim().toUpperCase(),
          planTier: form.planTier,
          note: form.note.trim() || null,
        }),
      });
      if (res.ok) {
        setForm(f => ({ ...f, code: generateCode(), note: '' }));
        await load();
      }
    } finally {
      setCreating(false);
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const available = codes.filter(c => !c.redeemedBy);
  const used = codes.filter(c => c.redeemedBy);

  return (
    <div className="px-6 py-5 max-w-4xl">
      <AdminNav active="codes" />

      <div className="mt-6 space-y-8">

        {/* Create new code */}
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            New invite code
          </h2>
          <form onSubmit={create} className="border border-border rounded-lg bg-card p-5">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Code</label>
                <div className="flex gap-2">
                  <input
                    value={form.code}
                    onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                    className="flex-1 min-w-0 px-3 py-2 border border-border rounded-md bg-background text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, code: generateCode() }))}
                    className="px-3 py-2 border border-border rounded-md text-xs text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors whitespace-nowrap"
                  >
                    New
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Plan</label>
                <select
                  value={form.planTier}
                  onChange={e => setForm(f => ({ ...f, planTier: e.target.value }))}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="pro">Pro ($199)</option>
                  <option value="growth">Growth ($499)</option>
                  <option value="agency">Agency ($799)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Note (optional)</label>
                <input
                  value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="e.g. for beta testers"
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={creating || !form.code.trim()}
              className="flex items-center gap-1.5 text-sm px-4 py-2 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {creating && <Loader2 size={13} className="animate-spin" />}
              Create code
            </button>
          </form>
        </section>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={13} className="animate-spin" /> Loading...
          </div>
        ) : (
          <>
            {/* Available codes */}
            <section>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Available ({available.length})
              </h2>
              {available.length === 0 ? (
                <p className="text-xs text-muted-foreground">No unused codes.</p>
              ) : (
                <div className="border border-border rounded-lg bg-card overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {['Code', 'Plan', 'Note', 'Created'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {available.map(c => (
                        <tr key={c.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-medium text-foreground">{c.code}</span>
                              <button onClick={() => copyCode(c.code)} className="text-muted-foreground hover:text-foreground transition-colors">
                                {copied === c.code ? <CheckCheck size={12} className="text-[#529E63]" /> : <Copy size={12} />}
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-foreground">{PLAN_LABELS[c.planTier] ?? c.planTier}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{c.note ?? '-'}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Used codes */}
            <section>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Used ({used.length})
              </h2>
              {used.length === 0 ? (
                <p className="text-xs text-muted-foreground">No codes redeemed yet.</p>
              ) : (
                <div className="border border-border rounded-lg bg-card overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {['Code', 'Plan', 'Redeemed by', 'Redeemed at', 'Note'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {used.map(c => (
                        <tr key={c.id} className="border-b border-border last:border-0 opacity-60">
                          <td className="px-4 py-3 text-xs font-mono text-foreground">{c.code}</td>
                          <td className="px-4 py-3 text-xs text-foreground">{PLAN_LABELS[c.planTier] ?? c.planTier}</td>
                          <td className="px-4 py-3 text-xs text-foreground">
                            {c.redeemedByName || c.redeemedByEmail || c.redeemedBy}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {c.redeemedAt ? new Date(c.redeemedAt).toLocaleDateString() : '-'}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{c.note ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

      </div>
    </div>
  );
}
