import { LoreLogo } from '@/components/layout/logo';
import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-10">
        <Link href="/home" className="mb-10" aria-label="Lore home">
          <LoreLogo />
        </Link>
        {children}
      </div>
      <footer className="border-t border-border/60 px-8 py-5 text-center">
        <p className="text-xs text-muted-foreground">
          By continuing, you agree to our{' '}
          <Link href="/terms" className="text-foreground hover:underline underline-offset-2">Terms of Service</Link>
          {' '}and{' '}
          <Link href="/privacy" className="text-foreground hover:underline underline-offset-2">Privacy Policy</Link>.
        </p>
      </footer>
    </div>
  );
}
