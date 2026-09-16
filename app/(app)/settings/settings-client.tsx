'use client';

import { useState, useEffect } from 'react';
import { signOut } from 'next-auth/react';
import Link from 'next/link';
import { Plus, Check, Loader2, Send, ExternalLink, Mic } from 'lucide-react';
import { ModKey } from '@/components/ui/mod-key';

interface User {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

const ALL_CATEGORIES: { id: string; label: string; description: string }[] = [
  { id: 'build-in-public', label: 'Build in Public', description: 'Current work, decisions, struggles, live metrics' },
  { id: 'educational', label: 'Educational', description: 'Frameworks, how-tos, hard-won lessons' },
  { id: 'storytelling', label: 'Storytelling', description: 'Origin stories, failures, turning points' },
  { id: 'authority', label: 'Authority', description: 'Results, case studies, credentials' },
  { id: 'contrarian-take', label: 'Contrarian Takes', description: 'Industry pushback, unpopular opinions' },
  { id: 'hot-take', label: 'Hot Takes', description: 'Strong specific opinions, bold claims' },
  { id: 'thought-leadership', label: 'Thought Leadership', description: 'Predictions, values, big-picture views' },
  { id: 'thesis-building', label: 'Thesis Building', description: 'The central insight your whole work is built around' },
  { id: 'case-study', label: 'Case Study', description: 'Data-backed before/after outcomes' },
];

const PLANS = [
  {
    id: 'base',
    label: 'Creator',
    price: '$99',
    period: '/mo',
    credits: 'Board only · no AI credits',
    features: [
      '1 brand',
      '3 post ideas/day · 5 edits/day',
      '2 AI interviews/month',
      'Learns and matches your voice',
      'Tracks what actually performs',
    ],
  },
  {
    id: 'pro',
    label: 'Pro',
    price: '$199',
    period: '/mo',
    highlight: false,
    credits: '2,000 credits/mo · ~100 chat posts or 80 AI images',
    features: [
      'Everything in Creator',
      'AI chat included',
      '3 post ideas/day · 15 edits/day',
      'Daily QRT and reaction opportunities',
      'Competitor gap analysis',
      'Priority support',
    ],
  },
  {
    id: 'growth',
    label: 'Growth',
    price: '$499',
    period: '/mo',
    highlight: true,
    credits: '5,000 credits/mo · ~250 chat posts or 200 AI images',
    features: [
      'Everything in Pro',
      '5 post ideas/day · 20 edits/day',
      '4 AI interviews/month',
      '2 strategy calls/month with a growth expert',
      'Advanced analytics and content reviews',
    ],
  },
  {
    id: 'agency',
    label: 'Agency',
    price: '$799',
    period: '/mo',
    credits: 'Unlimited credits',
    features: [
      '5 brands',
      'Everything in Growth',
      'Unlimited post ideas and edits',
      '10 AI interviews/month',
      'Team seats · White-label · API access',
    ],
  },
];

const CURRENT_PLAN = 'base';

const ACTION_LABELS: Record<string, string> = {
  chat_message:    'Chat message',
  chat_generate:   'Post generated in chat',
  generate_image:  'AI image',
  scrape_twitter:  'X / Twitter scrape',
  scrape_linkedin: 'LinkedIn scrape',
  trends_refresh:  'Trend refresh',
  monthly_grant:   'Monthly credits granted',
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}


interface CreditState {
  balance: number;
  monthlyAllowance: number;
  isUnlimited: boolean;
  periodEnd: string;
  plan: string;
  hosted?: boolean;
  transactions: Array<{ id: string; delta: number; action: string; balanceAfter: number; createdAt: string }>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </section>
  );
}


const CONTENT_STYLE_OPTIONS: { id: string; label: string; desc: string }[] = [
  { id: 'witty-short', label: 'Witty & sharp',    desc: 'Short, punchy posts that trust the reader to get it fast.' },
  { id: 'deep-value',  label: 'Deep & valuable',   desc: 'Substantive posts with real insight, the kind people save.' },
  { id: 'mixed',       label: 'Mix of both',        desc: 'Let the topic decide. Some tight, some in-depth.' },
];

function ContentStyleSection() {
  const [current, setCurrent] = useState<string>('mixed');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.contentStyle) setCurrent(data.contentStyle); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save(id: string) {
    setSaving(id);
    try {
      await fetch('/api/brands/content-style', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentStyle: id }),
      });
      setCurrent(id);
    } catch { /* ignore */ } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <Section title="Post Style">
        <div className="bg-card border border-border rounded-md px-4 py-4">
          <div className="h-3 w-48 rounded bg-muted animate-pulse" />
        </div>
      </Section>
    );
  }

  return (
    <Section title="Post Style">
      <div className="bg-card border border-border rounded-md divide-y divide-border">
        {CONTENT_STYLE_OPTIONS.map(opt => (
          <button
            key={opt.id}
            onClick={() => save(opt.id)}
            disabled={saving !== null}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors disabled:opacity-60"
          >
            <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
              current === opt.id ? 'border-foreground bg-foreground' : 'border-border'
            }`}>
              {current === opt.id && <div className="w-1.5 h-1.5 rounded-full bg-background" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.desc}</p>
            </div>
            {saving === opt.id && <Loader2 size={12} className="animate-spin text-muted-foreground shrink-0" />}
          </button>
        ))}
      </div>
    </Section>
  );
}

// ── Mainstream news pulse (opt-in for AI/tech/founder brands) ───────────────
function MainstreamNewsSection() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (typeof data?.mainstreamNewsEnabled === 'boolean') setEnabled(data.mainstreamNewsEnabled); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggle() {
    const next = !enabled;
    setSaving(true);
    try {
      const res = await fetch('/api/brands/mainstream-news', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mainstreamNewsEnabled: next }),
      });
      if (res.ok) setEnabled(next);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Section title="Mainstream news pulse">
        <div className="bg-card border border-border rounded-md px-4 py-4">
          <div className="h-3 w-48 rounded bg-muted animate-pulse" />
        </div>
      </Section>
    );
  }

  return (
    <Section title="Mainstream news pulse">
      <div className="bg-card border border-border rounded-md px-4 py-4 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Surface mainstream tech / AI news in your LinkedIn pulse</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Pulls fresh items from TechCrunch, Hacker News, TechMeme, and The Verge every 3 hours, then ranks them by relevance to your brand. Best for AI/tech/founder brands where commenting on news drives reach. Off-brand for niche-only brands.
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={saving}
          className={`relative shrink-0 w-10 h-6 rounded-full border transition-colors disabled:opacity-60 ${
            enabled ? 'bg-foreground border-foreground' : 'bg-muted border-border'
          }`}
          aria-label={enabled ? 'Disable mainstream news' : 'Enable mainstream news'}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-background transition-transform ${
            enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`} />
        </button>
      </div>
    </Section>
  );
}

// ── Satirical mode (opt-in, off-brand for most creators) ────────────────────
function SatiricalModeSection() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (typeof data?.allowUnhingedMode === 'boolean') setEnabled(data.allowUnhingedMode); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggle() {
    const next = !enabled;
    setSaving(true);
    try {
      const res = await fetch('/api/brands/unhinged-mode', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowUnhingedMode: next }),
      });
      if (res.ok) setEnabled(next);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Section title="Unhinged satire mode">
        <div className="bg-card border border-border rounded-md px-4 py-4">
          <div className="h-3 w-48 rounded bg-muted animate-pulse" />
        </div>
      </Section>
    );
  }

  return (
    <Section title="Unhinged satire mode">
      <div className="bg-card border border-border rounded-md px-4 py-4 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Allow satirical character-voice LinkedIn posts</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Unlocks a LinkedIn template that writes deliberately absurd, sincere-to-insanity posts in the voice of a fictional CEO, the kind of unhinged satire that mocks LinkedIn culture from inside it.
            Off-brand for most creators. Only enable if you want this register in your rotation.
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={saving}
          className={`relative shrink-0 w-10 h-6 rounded-full border transition-colors disabled:opacity-60 ${
            enabled ? 'bg-foreground border-foreground' : 'bg-muted border-border'
          }`}
          aria-label={enabled ? 'Disable satire mode' : 'Enable satire mode'}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-background transition-transform ${
            enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`} />
        </button>
      </div>
    </Section>
  );
}

function WeeklyFocusSection() {
  const [focus, setFocus] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.weeklyFocus != null) setFocus(data.weeklyFocus); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await fetch('/api/brands/focus', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weeklyFocus: focus }),
      });
      setSavedAt(new Date());
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Section title="Weekly Focus">
        <div className="bg-card border border-border rounded-md px-4 py-4">
          <div className="h-3 w-48 rounded bg-muted animate-pulse" />
        </div>
      </Section>
    );
  }

  return (
    <Section title="Weekly Focus">
      <div className="bg-card border border-border rounded-md px-4 py-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          What are you working on or focused on this week? Interview questions and post generation will prioritize this.
        </p>
        <textarea
          value={focus}
          onChange={e => { setFocus(e.target.value); setSavedAt(null); }}
          placeholder="e.g. Launching v2 of my SaaS, talking about the pricing decision..."
          rows={3}
          className="w-full text-sm text-foreground bg-background border border-border rounded-md px-3 py-2.5 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-md text-foreground hover:border-muted-foreground/50 transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 size={11} className="animate-spin" />}
            Save focus
          </button>
          {savedAt && (
            <span className="text-xs text-muted-foreground">Saved {timeAgo(savedAt.toISOString())}</span>
          )}
        </div>
      </div>
    </Section>
  );
}

function CorrectionsSection() {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState('');

  async function save() {
    if (!note.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() }),
      });
      if (!res.ok) throw new Error('Failed');
      setNote('');
      setSavedCount(c => c + 1);
    } catch {
      setError('Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  }

  return (
    <Section title="Writing Corrections">
      <div className="bg-card border border-border rounded-md px-4 py-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Tell Lore rules to always follow when generating or revising posts. These override defaults permanently.
        </p>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. Never use bullet points. Always write in lowercase. Don't use the word 'leverage'..."
          rows={3}
          className="w-full text-sm text-foreground bg-background border border-border rounded-md px-3 py-2.5 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || !note.trim()}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-md text-foreground hover:border-muted-foreground/50 transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 size={11} className="animate-spin" />}
            Add rule
          </button>
          <span className="text-xs text-muted-foreground"><ModKey /></span>
          {savedCount > 0 && (
            <span className="text-xs text-[#529E63] ml-auto">{savedCount} rule{savedCount > 1 ? 's' : ''} added</span>
          )}
        </div>
      </div>
    </Section>
  );
}

function TelegramSection() {
  const [status, setStatus] = useState<{ linked: boolean; linkedAt: string | null; botUsername: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/telegram/link')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setStatus(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function generateLink() {
    setGenerating(true);
    setError('');
    try {
      const res = await fetch('/api/telegram/link', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not generate link');
        return;
      }
      setLinkUrl(data.url);
      window.open(data.url, '_blank');
    } catch {
      setError('Network error');
    } finally {
      setGenerating(false);
    }
  }

  async function unlink() {
    setGenerating(true);
    try {
      await fetch('/api/telegram/unlink', { method: 'POST' });
      setStatus({ linked: false, linkedAt: null, botUsername: status?.botUsername ?? '' });
      setLinkUrl(null);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <Section title="Telegram">
        <div className="h-8 w-32 rounded bg-muted animate-pulse" />
      </Section>
    );
  }

  return (
    <Section title="Telegram">
      <div className="border border-border rounded-lg bg-card p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-9 h-9 rounded-lg bg-foreground/8 border border-border flex items-center justify-center shrink-0">
            <Send size={15} className="text-foreground/70" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Send ideas to Lore from Telegram</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Voice-memo or text the bot from anywhere. Each message lands as an idea on your board, ready to turn into a full post.
            </p>
          </div>
        </div>

        {status?.linked ? (
          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <div className="flex items-center gap-2 text-xs text-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Connected</span>
              {status.linkedAt && (
                <span className="text-muted-foreground">· linked {timeAgo(status.linkedAt)}</span>
              )}
            </div>
            <button
              onClick={unlink}
              disabled={generating}
              className="ml-auto text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            <button
              onClick={generateLink}
              disabled={generating}
              className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2 bg-foreground text-background rounded-md font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {generating ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
              {generating ? 'Generating link...' : linkUrl ? 'Open Telegram again' : 'Connect Telegram'}
            </button>
            {linkUrl && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Telegram should have opened. Tap <strong>Start</strong> in the chat to finish linking, then refresh this page.
              </p>
            )}
            {error && <p className="text-[11px] text-destructive">{error}</p>}
          </div>
        )}

        {status?.linked && (
          <div className="mt-3 pt-3 border-t border-border space-y-2">
            <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <Mic size={11} className="mt-0.5 shrink-0" />
              <span>Send a voice memo (up to 10 min) and Lore transcribes + saves it as an idea.</span>
            </div>
            <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <ExternalLink size={11} className="mt-0.5 shrink-0" />
              <span>Or text the bot directly. Same thing, faster.</span>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function CreditsSection({ credits, loading }: { credits: CreditState | null; loading: boolean }) {
  if (loading) {
    return (
      <Section title="Credits">
        <div className="bg-card border border-border rounded-md px-4 py-4 space-y-2">
          <div className="h-3 w-32 rounded bg-muted animate-pulse" />
          <div className="h-2 w-full rounded-full bg-muted animate-pulse mt-2" />
        </div>
      </Section>
    );
  }

  if (!credits) return null;

  if (credits.isUnlimited) {
    return (
      <Section title="Credits">
        <div className="bg-card border border-border rounded-md px-4 py-4">
          <p className="text-sm text-foreground">Unlimited credits · Agency plan</p>
        </div>
      </Section>
    );
  }

  const pct = Math.min(100, (credits.balance / credits.monthlyAllowance) * 100);
  const resetDate = new Date(credits.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const bal = credits.balance;

  return (
    <Section title="Credits">
      <div className="bg-card border border-border rounded-md px-4 divide-y divide-border">
        {/* Balance + bar */}
        <div className="py-4">
          <div className="flex items-baseline justify-between mb-2">
            <p className={`text-sm font-semibold ${credits.balance === 0 ? 'text-destructive' : 'text-foreground'}`}>
              {credits.balance.toLocaleString()}
              <span className="text-xs font-normal text-muted-foreground ml-1">
                / {credits.monthlyAllowance.toLocaleString()} this month
              </span>
            </p>
            <p className="text-xs text-muted-foreground">Resets {resetDate}</p>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${credits.balance === 0 ? 'bg-destructive' : 'bg-foreground/60'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Per-action credit rates */}
        <div className="py-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Credit rates</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {[
              { label: 'Chat message', cost: 10 },
              { label: 'Post drafted in chat', cost: '+10' },
              { label: "Today's Pulse generate", cost: 10 },
              { label: 'AI image', cost: 25 },
              { label: 'X / LinkedIn sync', cost: 3 },
              { label: 'Trending topics', cost: 1 },
            ].map(({ label, cost }) => (
              <span key={label} className="text-xs text-muted-foreground">
                {label} <span className="font-medium text-foreground tabular-nums">{cost} cr</span>
              </span>
            ))}
          </div>
        </div>

        {/* Recent transactions */}
        {credits.transactions.length > 0 && (
          <div className="py-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Recent</p>
            <ul className="space-y-1.5">
              {credits.transactions.slice(0, 5).map(tx => (
                <li key={tx.id} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground truncate">
                    {ACTION_LABELS[tx.action] ?? tx.action}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs font-medium tabular-nums ${tx.delta < 0 ? 'text-muted-foreground' : 'text-[#529E63]'}`}>
                      {tx.delta > 0 ? '+' : ''}{tx.delta}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">{timeAgo(tx.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}

function ContentPillarsSection() {
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.selectedCategories !== undefined) setSelected(data.selectedCategories); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function toggle(id: string) {
    setSelected(prev =>
      prev.includes(id)
        ? prev.filter(c => c !== id)
        : prev.length < 5 ? [...prev, id] : prev
    );
    setSavedAt(null);
  }

  async function save() {
    setSaving(true);
    try {
      await fetch('/api/brands/pillars', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedCategories: selected }),
      });
      setSavedAt(new Date());
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Section title="Content Pillars">
        <div className="bg-card border border-border rounded-md px-4 py-4">
          <div className="h-3 w-48 rounded bg-muted animate-pulse" />
        </div>
      </Section>
    );
  }

  return (
    <Section title="Content Pillars">
      <div className="bg-card border border-border rounded-md px-4 py-4 space-y-4">
        <p className="text-xs text-muted-foreground">
          Choose up to 5 categories. Interview questions and generated posts will prioritize these.
          {selected.length === 0 && ' Lore will suggest pillars after your first interview.'}
        </p>
        <div className="grid grid-cols-1 gap-2">
          {ALL_CATEGORIES.map(cat => {
            const active = selected.includes(cat.id);
            const disabled = !active && selected.length >= 5;
            return (
              <button
                key={cat.id}
                onClick={() => !disabled && toggle(cat.id)}
                disabled={disabled}
                className={`flex items-start gap-3 text-left px-3 py-2.5 rounded-md border transition-colors ${
                  active
                    ? 'border-foreground bg-foreground/5'
                    : disabled
                    ? 'border-border opacity-40 cursor-not-allowed'
                    : 'border-border hover:border-muted-foreground/50'
                }`}
              >
                <div className={`mt-0.5 h-3.5 w-3.5 rounded-sm border shrink-0 flex items-center justify-center transition-colors ${
                  active ? 'border-foreground bg-foreground' : 'border-muted-foreground/40'
                }`}>
                  {active && <Check size={9} className="text-background" strokeWidth={3} />}
                </div>
                <div>
                  <p className="text-xs font-medium text-foreground">{cat.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{cat.description}</p>
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-md text-foreground hover:border-muted-foreground/50 transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 size={11} className="animate-spin" />}
            Save pillars
          </button>
          {savedAt && (
            <span className="text-xs text-muted-foreground">Saved {timeAgo(savedAt.toISOString())}</span>
          )}
          {selected.length > 0 && (
            <span className="text-xs text-muted-foreground ml-auto">{selected.length}/5 selected</span>
          )}
        </div>
      </div>
    </Section>
  );
}

export function SettingsClient({ user }: { user: User }) {
  const [credits, setCredits] = useState<CreditState | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/credits')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setCredits(data); })
      .catch(() => {})
      .finally(() => setCreditsLoading(false));
  }, []);

  return (
    <div className="p-8 max-w-2xl mx-auto w-full space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Account, plan, and brand connections.</p>
      </div>

      {/* Account */}
      <Section title="Account">
        <div className="bg-card border border-border rounded-md px-4 divide-y divide-border">
          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="text-sm text-foreground mt-0.5">{user.name ?? 'Not set'}</p>
            </div>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="text-sm text-foreground mt-0.5">{user.email ?? ''}</p>
            </div>
          </div>
          <div className="py-3">
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="text-sm text-destructive hover:underline underline-offset-2"
            >
              Sign out
            </button>
          </div>
        </div>
      </Section>

      {/* Brands */}
      <Section title="Brands">
        <div className="bg-card border border-border rounded-md px-4">
          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Your brand</p>
              <p className="text-xs text-muted-foreground">Active</p>
            </div>
            <button className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
              Edit voice
            </button>
          </div>
          <div className="py-3">
            <Link
              href="/onboarding"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus size={13} />
              Add another brand
            </Link>
          </div>
        </div>
      </Section>

      {/* Content Pillars */}
      <ContentPillarsSection />

      {/* Post Style */}
      <ContentStyleSection />

      {/* Mainstream news pulse (opt-in) */}
      <MainstreamNewsSection />

      {/* Unhinged satire mode (opt-in LinkedIn template) */}
      <SatiricalModeSection />

      {/* Weekly Focus */}
      <WeeklyFocusSection />

      {/* Writing Corrections */}
      <CorrectionsSection />

      {/* Telegram */}
      <TelegramSection />

      {/* Credits and plans only exist on the hosted service */}
      {credits?.hosted !== false && <CreditsSection credits={credits} loading={creditsLoading} />}

      {credits?.hosted !== false && (
      <Section title="Plan">
        <div className="space-y-2">
          {PLANS.map(plan => {
            const active = plan.id === CURRENT_PLAN;
            return (
              <div
                key={plan.id}
                className={`border rounded-md px-4 py-4 transition-colors ${
                  active ? 'border-foreground bg-card' : 'border-border bg-card'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{plan.label}</span>
                    {active && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-foreground text-background">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="tabular text-lg font-semibold text-foreground">{plan.price}</span>
                    <span className="text-xs text-muted-foreground">{plan.period}</span>
                  </div>
                </div>
                {plan.credits && (
                  <p className="text-xs text-muted-foreground mb-2">{plan.credits}</p>
                )}
                <ul className="space-y-1 mb-3">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Check size={11} className="text-muted-foreground/60 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                {!active && (
                  <button className="text-xs px-3 py-1.5 border border-border rounded-md text-foreground hover:border-muted-foreground/50 transition-colors">
                    Switch to {plan.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Billing managed via Stripe.{' '}
          <button className="underline underline-offset-2 hover:text-foreground transition-colors">
            View invoices
          </button>
        </p>
      </Section>
      )}
    </div>
  );
}
