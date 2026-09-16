// Lore's board surface rebuilt in markup rather than screenshotted, so it stays
// crisp and responsive at any size. The posts, numbers, voice and data lines are
// real output, not placeholder copy.

const NAV = [
  { label: 'Board', active: true },
  { label: 'Chat', active: false },
  { label: 'Ideas', active: false },
  { label: 'Insights', active: false },
  { label: 'Rules', active: false },
  { label: 'Vault', active: false },
];

interface ReadRow {
  text: string;
  platform: 'X' | 'LinkedIn';
  views: string;
  likes: string;
  tag?: { label: string; tone: 'best' | 'flat' };
}

const READ_ROWS: ReadRow[] = [
  {
    text: 'we shipped the thing nobody asked for and it became 40% of revenue',
    platform: 'X',
    views: '184k',
    likes: '2,140',
    tag: { label: 'your best', tone: 'best' },
  },
  {
    text: 'the first 100 customers came from me answering support tickets at 2am',
    platform: 'X',
    views: '96.4k',
    likes: '1,208',
  },
  {
    text: 'hiring a VP of sales before you can sell it yourself is how seed rounds die',
    platform: 'LinkedIn',
    views: '41.2k',
    likes: '517',
  },
  {
    text: 'our churn dropped 9 points when we made onboarding shorter, not smarter',
    platform: 'LinkedIn',
    views: '28.7k',
    likes: '349',
  },
  {
    text: 'a thread about our funding round that nobody outside the company cared about',
    platform: 'X',
    views: '6.1k',
    likes: '62',
    tag: { label: 'underperformed', tone: 'flat' },
  },
];

function PlatformChip({ platform }: { platform: 'X' | 'LinkedIn' }) {
  if (platform === 'LinkedIn') {
    return (
      <span className="inline-flex items-center gap-1.5 shrink-0">
        <span className="grid place-items-center size-[15px] rounded-[3px] bg-[#0A66C2] text-white text-[9px] font-bold leading-none">
          in
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <span className="grid place-items-center size-[15px] rounded-[3px] bg-[#0F1419] text-white text-[9px] font-bold leading-none">
        X
      </span>
    </span>
  );
}

export function AppPanel() {
  return (
    <div className="rounded-xl border border-[#E4E2DD] bg-white overflow-hidden shadow-[0_2px_4px_rgba(55,53,47,0.04),0_24px_56px_-16px_rgba(55,53,47,0.22)]">
      {/* Title bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#EDEBE6] bg-[#F7F6F2]">
        <div className="flex items-center gap-2.5">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[#FF5F57]" />
            <span className="size-2.5 rounded-full bg-[#FEBC2E]" />
            <span className="size-2.5 rounded-full bg-[#28C840]" />
          </span>
          <span className="ml-1 font-mono text-[11px] text-muted-foreground">lore.app / board</span>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground/70 border border-[#E4E2DD] rounded-[4px] px-1.5 py-0.5">
            90 days
          </span>
          <span className="rounded-md bg-[#37352F] text-white text-[11px] font-medium px-2.5 py-1">New post</span>
        </div>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside className="hidden sm:flex flex-col w-[168px] shrink-0 border-r border-[#EDEBE6] bg-[#F4F3EF] py-3">
          <div className="flex items-center gap-2 px-3 pb-3 mb-1 border-b border-[#E7E5DF]">
            <span className="grid place-items-center size-6 rounded-[5px] bg-[#37352F] text-white text-[11px] font-semibold">
              M
            </span>
            <span className="text-[13px] font-medium text-foreground truncate">Maya Chen</span>
          </div>
          {NAV.map((n) => (
            <span
              key={n.label}
              className={`mx-2 px-2.5 py-[7px] rounded-md text-[13px] ${
                n.active ? 'bg-white text-foreground shadow-[0_1px_2px_rgba(55,53,47,0.06)] font-medium' : 'text-muted-foreground'
              }`}
            >
              {n.label}
            </span>
          ))}
          <div className="mt-auto px-3 pt-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[#2E7D32] bg-[#E9F5EA] rounded-[4px] px-2 py-1">
              <span className="size-1.5 rounded-full bg-[#4CAF50]" />
              learning on
            </span>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between px-4 sm:px-5 pt-4 pb-3">
            <div className="flex items-baseline gap-2.5">
              <h3 className="text-[15px] font-semibold text-foreground">What it read</h3>
              <span className="font-mono text-[11px] text-muted-foreground">892 posts · last 90 days</span>
            </div>
            <span className="hidden sm:inline font-mono text-[11px] text-[#2383E2]">done in 1m 48s</span>
          </div>

          <div className="border-t border-[#EFEDE8]">
            {READ_ROWS.map((row) => (
              <div
                key={row.text}
                className="flex items-center gap-3 px-4 sm:px-5 py-[11px] border-b border-[#F2F0EB] last:border-b-0"
              >
                <PlatformChip platform={row.platform} />
                <span className="flex-1 min-w-0 truncate text-[13.5px] text-foreground/90">{row.text}</span>
                {row.tag && (
                  <span
                    className={`hidden md:inline shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded-[3px] ${
                      row.tag.tone === 'best' ? 'bg-[#E7F1FC] text-[#1B6FC4]' : 'bg-[#F3F1EC] text-muted-foreground'
                    }`}
                  >
                    {row.tag.label}
                  </span>
                )}
                <span className="shrink-0 whitespace-nowrap tabular-nums font-mono text-[11px] text-muted-foreground w-[74px] text-right">
                  {row.views} views
                </span>
                <span className="hidden sm:flex shrink-0 items-center gap-1 tabular-nums font-mono text-[11px] text-[#E0245E] w-[38px] justify-end">
                  <span aria-hidden>♥</span>
                  {row.likes}
                </span>
              </div>
            ))}
          </div>

          {/* Readout strip */}
          <div className="border-t border-[#EFEDE8] bg-[#FCFBF9] px-4 sm:px-5 py-4 space-y-2.5">
            <p className="text-[13.5px] leading-relaxed text-foreground/90">
              <span className="font-mono text-[10px] text-[#2383E2] mr-2 align-middle">VOICE</span>
              Numbers first, one concrete decision per post, and the lesson lands at the end rather than the front
            </p>
            <p className="text-[13.5px] leading-relaxed text-foreground/90">
              <span className="font-mono text-[10px] text-[#7A5AF8] mr-2 align-middle">DATA</span>
              Posts that open with a revenue number pull about{' '}
              <span className="font-medium text-[#7A5AF8]">6.2x</span> the rest, across 14 of them in the last 90
            </p>
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              <span className="font-mono text-[10px] text-[#C98A16] mr-2 align-middle">GAP</span>
              11 days since your last post, and 7 drafts still sitting on the board
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
