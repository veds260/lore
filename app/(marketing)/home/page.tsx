import Link from 'next/link';
import { LoreLogo } from '@/components/layout/logo';
import { StarButton, FollowRow, GITHUB_URL } from '@/components/marketing/social';
import { ProductTour } from '@/components/marketing/product-tour';
import { InstallPicker } from '@/components/marketing/install-picker';

export default function LandingPage() {
  return (
    <div className="min-h-svh lg:h-svh lg:min-h-[700px] bg-background text-foreground flex flex-col overflow-x-clip">
      <nav className="w-full max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
        <LoreLogo />
        <div className="flex items-center gap-5">
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Sign in
          </Link>
          <StarButton compact />
        </div>
      </nav>

      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-8 lg:py-0 grid lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-12 lg:gap-16 items-center">
        <div>
          <h1 className="text-[2.5rem] sm:text-[3.25rem] leading-[1.03] font-semibold tracking-tight text-balance">
            An open source CMO that runs on your laptop
          </h1>
          <p className="mt-5 text-[18px] text-foreground/70 leading-relaxed max-w-md">
            It learns how you write from your own posts, then drafts new ones in that voice
          </p>

          <div className="mt-8 max-w-lg">
            <InstallPicker />
          </div>

          <dl className="mt-9 grid grid-cols-2 max-w-lg border-t border-border">
            <div className="pt-4 pr-4">
              <dt className="text-[12px] text-muted-foreground">Founders</dt>
              <dd className="mt-1 text-[15px] leading-snug">
                <span className="font-semibold">Keep the $10k a month</span> an agency would charge you
              </dd>
            </div>
            <div className="pt-4 pl-4 border-l border-border">
              <dt className="text-[12px] text-muted-foreground">Ghostwriters</dt>
              <dd className="mt-1 text-[15px] leading-snug">
                <span className="font-semibold">Charge $5k a client</span> with every voice on one install
              </dd>
            </div>
          </dl>
        </div>

        <ProductTour />
      </main>

      <footer className="w-full max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
        <FollowRow />
        <p className="text-[12px] text-muted-foreground">
          Free and{' '}
          <Link href={GITHUB_URL} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline hover:text-foreground">
            AGPL-3.0
          </Link>
          , by Vedaang Singh
        </p>
      </footer>
    </div>
  );
}
