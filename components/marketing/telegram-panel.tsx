// The morning brief, drawn the way Telegram looks now: light header with the
// avatar and name, a soft wallpaper behind the thread, wide-radius bubbles, and
// the pale green outgoing bubble with green ticks.

function Ticks() {
  return (
    <svg viewBox="0 0 18 12" className="inline-block w-[14px] h-[9px] ml-1 align-middle" aria-hidden>
      <path d="M1 6.6 L4.4 9.8 L10.4 2.5" fill="none" stroke="#4FAE4E" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.6 9.7 L13.6 2.5" fill="none" stroke="#4FAE4E" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Incoming({ children, time }: { children: React.ReactNode; time: string }) {
  return (
    <div className="relative max-w-[88%] w-fit rounded-[18px] rounded-bl-[6px] bg-white px-3.5 pt-2 pb-1.5 shadow-[0_1px_2px_rgba(16,35,47,0.08)]">
      <p className="text-[13.5px] leading-[1.42] text-[#0F1419]">{children}</p>
      <span className="block text-right text-[10.5px] text-[#A0AAB4] leading-none mt-1">{time}</span>
    </div>
  );
}

export function TelegramPanel() {
  return (
    <div className="rounded-[14px] overflow-hidden border border-[#E4E2DD] shadow-[0_2px_4px_rgba(55,53,47,0.04),0_24px_56px_-16px_rgba(55,53,47,0.2)] max-w-md bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-[#EDEFF1]">
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] text-[#3390EC] shrink-0" fill="none" aria-hidden>
          <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="grid place-items-center size-9 rounded-full bg-gradient-to-b from-[#6EC8F6] to-[#3390EC] text-white text-[14px] font-semibold shrink-0">
          L
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[#0F1419] leading-tight">Lore</p>
          <p className="text-[12px] text-[#707991] leading-tight">bot</p>
        </div>
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] text-[#707991] shrink-0" fill="currentColor" aria-hidden>
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </div>

      {/* Thread */}
      <div className="relative px-3 py-4 space-y-2 bg-[linear-gradient(160deg,#EEF3F8_0%,#E7EEF6_45%,#EDE9F6_100%)]">
        <div className="flex justify-center pb-1">
          <span className="rounded-full bg-black/[0.07] backdrop-blur-sm text-[#5A6270] text-[11px] font-medium px-3 py-1">
            Today
          </span>
        </div>

        <Incoming time="08:30">
          morning. your best one this week was the churn post, 28.7k views and 349 likes, and the pattern across your
          strongest posts is a number in the first line
        </Incoming>

        <Incoming time="08:30">
          you have 7 drafts on the board and the oldest has been sitting 12 days. the pricing one is marked ready, want
          me to queue it for today?
        </Incoming>

        <div className="flex justify-end">
          <div className="max-w-[82%] w-fit rounded-[18px] rounded-br-[6px] bg-[#EFFDDE] px-3.5 pt-2 pb-1.5 shadow-[0_1px_2px_rgba(16,35,47,0.08)]">
            <p className="text-[13.5px] leading-[1.42] text-[#0F1419]">
              queue it, and draft something on the onboarding rewrite
            </p>
            <span className="flex items-center justify-end text-[10.5px] text-[#6BA84F] leading-none mt-1">
              08:34
              <Ticks />
            </span>
          </div>
        </div>

        <Incoming time="08:34">
          on it. numbers-first opener is your thing, so i am leading with the 9 point drop
        </Incoming>
      </div>

      {/* Composer */}
      <div className="flex items-center gap-3 bg-white px-4 py-3 border-t border-[#EDEFF1]">
        <svg viewBox="0 0 24 24" className="w-[20px] h-[20px] text-[#707991] shrink-0" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8.5 13.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="9.2" cy="9.8" r="1" fill="currentColor" />
          <circle cx="14.8" cy="9.8" r="1" fill="currentColor" />
        </svg>
        <span className="flex-1 text-[14px] text-[#A0AAB4]">Message</span>
        <svg viewBox="0 0 24 24" className="w-[20px] h-[20px] text-[#3390EC] shrink-0" fill="currentColor" aria-hidden>
          <path d="M3.4 20.4l17.4-8.2c.8-.4.8-1.6 0-2L3.4 2c-.7-.3-1.5.2-1.4 1l.6 6c.1.5.5.9 1 1l9.9 1.5c.3 0 .3.5 0 .5L3.6 13.5c-.5.1-.9.5-1 1l-.6 6c-.1.7.7 1.2 1.4.9z" />
        </svg>
      </div>
    </div>
  );
}
