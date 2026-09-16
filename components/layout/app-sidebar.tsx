'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { signOut } from 'next-auth/react';
import { LoreLogo } from './logo';
import {
  LayoutGrid, Lightbulb, Mic2, Settings, ChevronDown, ChevronsUpDown, MessageSquare, ShieldCheck, LogOut, User, Sparkles, PanelLeftClose, PanelLeftOpen, Archive, Repeat,
} from 'lucide-react';

const NAV = [
  { href: '/board',      label: 'Board',     icon: LayoutGrid },
  { href: '/chat',       label: 'Chat',      icon: MessageSquare },
  { href: '/ideas',      label: 'Ideas',     icon: Lightbulb },
  { href: '/learning',   label: 'Insights',  icon: Sparkles },
  { href: '/rituals',    label: 'Rituals',   icon: Repeat },
  { href: '/vault',      label: 'Vault',     icon: Archive },
  { href: '/profile',    label: 'Profile',   icon: User },
  { href: '/interviews', label: 'Sessions',  icon: Mic2 },
];

const STORAGE_KEY = 'lore-sidebar-collapsed';

interface CreditState {
  balance: number;
  monthlyAllowance: number;
  isUnlimited: boolean;
  periodEnd: string;
  plan: string;
  hosted?: boolean;
}

function CreditWidget({ collapsed }: { collapsed: boolean }) {
  const [credits, setCredits] = useState<CreditState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/credits')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setCredits(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (credits && credits.hosted === false) return null;

  if (collapsed) {
    const label = credits?.isUnlimited
      ? 'Unlimited credits'
      : credits
        ? `${credits.balance.toLocaleString()} / ${credits.monthlyAllowance.toLocaleString()} credits`
        : 'Credits';
    return (
      <Link
        href="/settings"
        title={label}
        aria-label={label}
        className="flex items-center justify-center mx-2 mb-1 h-8 rounded-md hover:bg-accent transition-colors"
      >
        <span className={`text-sm ${credits && !credits.isUnlimited && credits.balance === 0 ? 'text-destructive' : 'text-muted-foreground'}`}>⚡</span>
      </Link>
    );
  }

  return (
    <Link href="/settings" className="block px-3 py-2 mx-2 mb-1 rounded-md hover:bg-accent transition-colors group">
      {loading ? (
        <div className="h-3 w-20 rounded bg-muted animate-pulse" />
      ) : credits?.isUnlimited ? (
        <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
          ⚡ Unlimited
        </span>
      ) : credits ? (
        <>
          <span className={`text-xs transition-colors ${
            credits.balance === 0
              ? 'text-destructive'
              : 'text-muted-foreground group-hover:text-foreground'
          }`}>
            ⚡ {credits.balance.toLocaleString()} / {credits.monthlyAllowance.toLocaleString()}
          </span>
          <div className="mt-1.5 h-[3px] w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                credits.balance === 0 ? 'bg-destructive' : 'bg-muted-foreground/50'
              }`}
              style={{
                width: `${Math.min(100, (credits.balance / credits.monthlyAllowance) * 100)}%`,
              }}
            />
          </div>
        </>
      ) : null}
    </Link>
  );
}

function UserMenu({ user, collapsed }: { user: { name?: string | null; email?: string | null }; collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const initial = user.name?.[0] ?? user.email?.[0] ?? '?';
  const displayName = user.name ?? user.email ?? '';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title={collapsed ? displayName : undefined}
        className={`w-full flex items-center rounded-md hover:bg-accent cursor-pointer transition-colors ${
          collapsed ? 'justify-center py-2' : 'gap-2 px-3 py-2'
        }`}
      >
        <div className="w-6 h-6 rounded-full bg-border flex items-center justify-center text-xs text-muted-foreground shrink-0 font-medium">
          {initial}
        </div>
        {!collapsed && (
          <>
            <span className="text-xs text-foreground truncate flex-1 text-left">{displayName}</span>
            <ChevronDown size={12} className={`text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {open && (
        <div className={`absolute bottom-full bg-card border border-border rounded-lg shadow-lg overflow-hidden z-50 ${
          collapsed ? 'left-full ml-2 w-48' : 'left-0 right-0 mb-1'
        }`}>
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs font-medium text-foreground truncate">{user.name ?? 'Account'}</p>
            <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <LogOut size={13} strokeWidth={1.8} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  user: { name?: string | null; email?: string | null; image?: string | null };
  activeBrand?: { id: string; name: string } | null;
  allBrands?: { id: string; name: string }[];
  canAddBrand?: boolean;
  isAdmin?: boolean;
}

export function AppSidebar({ user, activeBrand, allBrands = [], canAddBrand = false, isAdmin }: Props) {
  const pathname = usePathname();
  const [brandOpen, setBrandOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const brandRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.resolve()
      .then(() => {
        try {
          const stored = window.localStorage.getItem(STORAGE_KEY);
          if (stored === '1') setCollapsed(true);
        } catch {}
        setHydrated(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {}
  }, [collapsed, hydrated]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (brandRef.current && !brandRef.current.contains(e.target as Node)) setBrandOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const toggle = () => {
    setBrandOpen(false);
    setCollapsed(c => !c);
  };

  return (
    <aside
      className={`shrink-0 flex flex-col border-r border-border bg-sidebar h-full transition-[width] duration-200 ease-out ${
        collapsed ? 'w-14' : 'w-56'
      }`}
    >
      {/* Header: logo + collapse toggle */}
      <div className={`flex items-center pt-4 pb-3 border-b border-border ${collapsed ? 'flex-col gap-2 px-2' : 'justify-between px-4'}`}>
        {!collapsed && <LoreLogo size="sm" />}
        <button
          onClick={toggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          {collapsed ? <PanelLeftOpen size={15} strokeWidth={1.8} /> : <PanelLeftClose size={15} strokeWidth={1.8} />}
        </button>
      </div>

      {/* Brand selector */}
      <div className="relative px-2 pt-3 pb-3 border-b border-border" ref={brandRef}>
        <button
          onClick={() => setBrandOpen(o => !o)}
          title={collapsed ? (activeBrand?.name ?? 'No brand yet') : undefined}
          className={`w-full flex items-center rounded-md hover:bg-accent transition-colors text-left ${
            collapsed ? 'justify-center py-2' : 'gap-2.5 px-2 py-2'
          }`}
        >
          {activeBrand ? (
            <>
              <div className="w-5 h-5 rounded bg-foreground flex items-center justify-center shrink-0">
                <span className="text-[9px] font-bold text-background">{activeBrand.name[0].toUpperCase()}</span>
              </div>
              {!collapsed && (
                <>
                  <span className="text-xs font-medium text-foreground truncate flex-1">{activeBrand.name}</span>
                  <ChevronsUpDown size={12} className="text-muted-foreground shrink-0" />
                </>
              )}
            </>
          ) : (
            <>
              <div className="w-5 h-5 rounded bg-border shrink-0" />
              {!collapsed && (
                <>
                  <span className="text-xs text-muted-foreground flex-1">No brand yet</span>
                  <ChevronsUpDown size={12} className="text-muted-foreground shrink-0" />
                </>
              )}
            </>
          )}
        </button>
        {brandOpen && (
          <div
            className={`rounded-md border border-border bg-card shadow-md overflow-hidden ${
              collapsed ? 'absolute left-full ml-2 mt-1 w-48 z-50' : 'mt-1'
            }`}
          >
            {allBrands.map(b => (
              <button
                key={b.id}
                onClick={async () => {
                  if (b.id === activeBrand?.id) { setBrandOpen(false); return; }
                  await fetch('/api/brands/switch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ brandId: b.id }),
                  });
                  setBrandOpen(false);
                  window.location.href = '/board';
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${b.id === activeBrand?.id ? 'text-foreground font-medium bg-accent' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
              >
                <div className="w-4 h-4 rounded bg-foreground/20 flex items-center justify-center shrink-0">
                  <span className="text-[8px] font-bold">{b.name[0].toUpperCase()}</span>
                </div>
                <span className="truncate">{b.name}</span>
                {b.id === activeBrand?.id && <span className="ml-auto text-[9px] text-muted-foreground">active</span>}
              </button>
            ))}
            {canAddBrand && (
              <Link
                href="/onboarding?newBrand=true"
                onClick={() => setBrandOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground border-t border-border"
              >
                <span className="text-base leading-none">+</span>
                <span>Add account</span>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          const tourKey = href.replace('/', '');
          return (
            <Link
              key={href}
              href={href}
              data-tour={`nav-${tourKey}`}
              title={collapsed ? label : undefined}
              className={`flex items-center rounded-md text-sm transition-colors ${
                collapsed ? 'justify-center py-2' : 'gap-2.5 px-3 py-2'
              } ${
                active
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <Icon size={15} strokeWidth={1.8} />
              {!collapsed && label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-2 pb-4">
        <CreditWidget collapsed={collapsed} />
        {isAdmin && (
          <Link
            href="/admin"
            title={collapsed ? 'Admin' : undefined}
            className={`flex items-center rounded-md text-xs transition-colors mb-0.5 ${
              collapsed ? 'justify-center py-2' : 'gap-2.5 px-3 py-2'
            } ${
              pathname.startsWith('/admin')
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            <ShieldCheck size={13} strokeWidth={1.8} />
            {!collapsed && 'Admin'}
          </Link>
        )}
        <Link
          href="/settings"
          data-tour="nav-settings"
          title={collapsed ? 'Settings' : undefined}
          className={`flex items-center rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mb-0.5 ${
            collapsed ? 'justify-center py-2' : 'gap-2.5 px-3 py-2'
          }`}
        >
          <Settings size={13} strokeWidth={1.8} />
          {!collapsed && 'Settings'}
        </Link>
        <UserMenu user={user} collapsed={collapsed} />
      </div>
    </aside>
  );
}
