'use client';

import { signOut } from 'next-auth/react';
import { LoreLogo } from '@/components/layout/logo';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-8 py-5 border-b border-border flex items-center justify-between">
        <LoreLogo size="sm" />
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Sign out
        </button>
      </header>
      <main className="flex-1 flex items-start justify-center pt-16 px-4 pb-16">
        {children}
      </main>
    </div>
  );
}
