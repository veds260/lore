import Link from 'next/link';
import { LoreLogo } from '@/components/layout/logo';
import { CommandBlock } from '@/components/marketing/command-block';
import { StarButton, FollowRow, GITHUB_URL } from '@/components/marketing/social';
import { RewriteDemo } from '@/components/marketing/rewrite-demo';
import { HowItWorks } from '@/components/marketing/how-it-works';

const INSTALL = 'curl -fsSL https://raw.githubusercontent.com/veds260/lore/main/install.sh | sh';
const CONNECT = 'claude mcp add lore -- npm --prefix ~/lore run mcp';

const CARD_SHADOW = 'shadow-[0_2px_4px_rgba(55,53,47,0.04),0_20px_48px_-20px_rgba(55,53,47,0.2)]';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <nav className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <LoreLogo />
        <div className="flex items-center gap-5">
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Sign in
          </Link>
          <StarButton compact />
        </div>
      </nav>

      {/* The whole pitch in one screen: what it is, the problem you can see, the fix */}
      <section className="max-w-6xl mx-auto px-6 pt-8 pb-20 grid lg:grid-cols-[0.95fr_1.05fr] gap-12 items-center">
        <div>
          <h1 className="text-[2.6rem] sm:text-[3.5rem] leading-[1.02] font-semibold tracking-tight text-balance">
            An open source CMO that runs on your laptop
          </h1>
          <p className="mt-5 text-[19px] text-foreground/75 leading-relaxed max-w-md">
            It learns how you write, then drafts posts nobody can tell a machine touched
          </p>
          <div className="mt-8">
            <CommandBlock command={INSTALL} wrap />
          </div>
          <p className="mt-3 text-[13px] text-muted-foreground">Free forever. Runs on the AI you already pay for.</p>
        </div>

        <RewriteDemo />
      </section>

      {/* Who it pays */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <h2 className="text-[1.75rem] font-semibold tracking-tight">Who it&apos;s for</h2>
        <div className="mt-6 grid md:grid-cols-2 gap-5">
          <div className={`rounded-2xl border border-[#CFE3F8] bg-[#F3F8FE] p-7 ${CARD_SHADOW}`}>
            <p className="text-[13px] font-medium text-[#1B6FC4]">Founders</p>
            <p className="mt-2 text-[2.4rem] font-semibold tracking-tight leading-none">Keep the $10k</p>
            <p className="mt-3 text-[15px] text-foreground/70 leading-relaxed max-w-sm">
              That is roughly what an agency charges each month to sound like you. Lore learns it from your own posts
              and drafts between meetings.
            </p>
          </div>
          <div className={`rounded-2xl border border-[#CDE9D6] bg-[#F2FAF5] p-7 ${CARD_SHADOW}`}>
            <p className="text-[13px] font-medium text-[#1E7B3A]">Ghostwriters</p>
            <p className="mt-2 text-[2.4rem] font-semibold tracking-tight leading-none">Charge $5k a client</p>
            <p className="mt-3 text-[15px] text-foreground/70 leading-relaxed max-w-sm">
              Every client gets their own voice and rules on one install, so the fourth client costs you the same
              evening as the first.
            </p>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground">Market rates, not a promise about what you will earn.</p>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <h2 className="text-[1.75rem] font-semibold tracking-tight">How it works</h2>
        <div className="mt-6">
          <HowItWorks />
        </div>
        <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-[14px] text-muted-foreground shrink-0">Live in Claude instead?</p>
          <div className="w-full max-w-lg">
            <CommandBlock command={CONNECT} />
          </div>
        </div>
      </section>

      {/* Close */}
      <section className="bg-[#1A1917] py-20">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-[2.2rem] sm:text-[2.6rem] leading-[1.08] font-semibold tracking-tight text-white text-balance">
            Your CMO is one command away
          </h2>
          <div className="mt-8 text-left">
            <CommandBlock command={INSTALL} tone="dark" wrap />
          </div>
          <p className="mt-4 text-[13px] text-white/45">
            Free, nothing leaves your machine, and nothing posts until you approve it
          </p>
          <div className="mt-8 flex flex-wrap justify-center items-center gap-3">
            <StarButton />
            <FollowRow tone="dark" />
          </div>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <LoreLogo />
          <span className="text-[13px] text-muted-foreground">by Vedaang Singh</span>
        </div>
        <p className="text-[12px] text-muted-foreground">
          <Link href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">
            AGPL-3.0
          </Link>{' '}
          · <Link href="/login" className="hover:text-foreground">Hosted version</Link>
        </p>
      </footer>
    </div>
  );
}
