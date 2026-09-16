'use client';

import { useState } from 'react';
import { Loader2, Pencil, Check, X } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const VALID_PLAN_TIERS = ['free', 'base', 'pro', 'growth', 'agency'] as const;
type PlanTier = typeof VALID_PLAN_TIERS[number];

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  planTier: PlanTier;
  createdAt: string;
  creditBalance: number;
  totalGenerations: number;
  totalRevisions: number;
  lastActiveAt: string | null;
}

const PLAN_BADGE: Record<PlanTier, string> = {
  free:   'bg-zinc-800 text-zinc-300',
  base:   'bg-blue-950 text-blue-300',
  pro:    'bg-violet-950 text-violet-300',
  growth: 'bg-amber-950 text-amber-300',
  agency: 'bg-emerald-950 text-emerald-300',
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface EditState {
  planTier: PlanTier;
  grantCredits: string;
}

function UserRow({ user: initial }: { user: AdminUser }) {
  const [user, setUser] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<EditState>({ planTier: initial.planTier, grantCredits: '' });

  function startEdit() {
    setEdit({ planTier: user.planTier, grantCredits: '' });
    setError('');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError('');
  }

  async function saveEdit() {
    setSaving(true);
    setError('');
    try {
      const body: { planTier?: string; grantCredits?: number } = {};
      if (edit.planTier !== user.planTier) body.planTier = edit.planTier;
      const grant = parseInt(edit.grantCredits, 10);
      if (!isNaN(grant) && grant > 0) body.grantCredits = grant;

      if (Object.keys(body).length === 0) {
        setEditing(false);
        return;
      }

      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await res.json() as { user?: AdminUser; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Save failed');

      if (data.user) {
        setUser({ ...user, ...data.user });
      }
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <tr className="border-b border-border hover:bg-muted/20 transition-colors">
        <td className="px-4 py-3">
          <div className="text-xs font-medium text-foreground truncate max-w-[200px]">{user.email}</div>
          {user.name && <div className="text-[10px] text-muted-foreground">{user.name}</div>}
        </td>
        <td className="px-4 py-3">
          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide', PLAN_BADGE[user.planTier])}>
            {user.planTier}
          </span>
        </td>
        <td className="px-4 py-3 text-xs text-foreground tabular-nums">{user.creditBalance.toLocaleString()}</td>
        <td className="px-4 py-3 text-xs text-foreground tabular-nums">{user.totalGenerations}</td>
        <td className="px-4 py-3 text-xs text-foreground tabular-nums">{user.totalRevisions}</td>
        <td className="px-4 py-3 text-xs text-muted-foreground">{timeAgo(user.lastActiveAt)}</td>
        <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(user.createdAt)}</td>
        <td className="px-4 py-3">
          <button
            onClick={startEdit}
            className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
          >
            <Pencil size={11} />
            Edit
          </button>
        </td>
      </tr>

      {editing && (
        <tr className="border-b border-border bg-muted/30">
          <td colSpan={8} className="px-4 py-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Plan</label>
                <select
                  value={edit.planTier}
                  onChange={e => setEdit(s => ({ ...s, planTier: e.target.value as PlanTier }))}
                  className="text-xs bg-background border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                >
                  {VALID_PLAN_TIERS.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Grant credits</label>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={edit.grantCredits}
                  onChange={e => setEdit(s => ({ ...s, grantCredits: e.target.value }))}
                  className="text-xs bg-background border border-border rounded px-2 py-1 text-foreground w-24 focus:outline-none focus:ring-1 focus:ring-foreground/20"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                  Save
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded border border-border hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <X size={11} />
                  Cancel
                </button>
              </div>

              {error && <span className="text-xs text-destructive">{error}</span>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function UsersClient({ initialUsers }: { initialUsers: AdminUser[] }) {
  return (
    <div className="px-6 py-5 max-w-6xl">
      {/* Nav */}
      <AdminNav active="users" />

      <div className="mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            All Users ({initialUsers.length})
          </h2>
        </div>

        <div className="border border-border rounded-lg bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Email</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Plan</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Credits</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Generates</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Revisions</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Last active</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Joined</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody>
                {initialUsers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-xs text-muted-foreground">
                      No users yet
                    </td>
                  </tr>
                ) : (
                  initialUsers.map(u => <UserRow key={u.id} user={u} />)
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// Shared nav, rendered inside each client component so it's available without a layout change
export function AdminNav({ active }: { active: 'cron' | 'patterns' | 'users' | 'costs' | 'intelligence' | 'visuals' | 'codes' }) {
  const tabs = [
    { key: 'cron' as const,          label: 'Cron Jobs',    href: '/admin' },
    { key: 'intelligence' as const,  label: 'Intelligence', href: '/admin/intelligence' },
    { key: 'users' as const,         label: 'Users',        href: '/admin/users' },
    { key: 'patterns' as const,      label: 'Patterns',     href: '/admin/patterns' },
    { key: 'visuals' as const,       label: 'Visuals',      href: '/admin/visuals' },
    { key: 'codes' as const,         label: 'Invite Codes', href: '/admin/codes' },
  ];

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold">Admin</h1>
          <p className="text-xs text-muted-foreground mt-0.5">System management and user oversight.</p>
        </div>
      </div>
      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map(tab => (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              'text-xs font-medium px-3 py-2 border-b-2 -mb-px transition-colors',
              active === tab.key
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
