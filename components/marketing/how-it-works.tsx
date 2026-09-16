const CARD = 'rounded-2xl border border-[#E4E2DD] bg-white p-5 shadow-[0_2px_4px_rgba(55,53,47,0.04),0_20px_48px_-20px_rgba(55,53,47,0.2)]';

function XChip() {
  return (
    <span className="grid place-items-center size-4 rounded-[3px] bg-[#0F1419] text-white text-[9px] font-bold shrink-0">X</span>
  );
}

function ReadsYou() {
  const rows = [
    { t: 'we shipped the thing nobody asked for', v: '184k', best: true },
    { t: 'first 100 customers came from support tickets', v: '96.4k' },
    { t: 'a thread about our funding round', v: '6.1k', flop: true },
  ];
  return (
    <div className="mt-4 rounded-lg border border-[#EFEDE8] divide-y divide-[#F2F0EB]">
      {rows.map((r) => (
        <div key={r.t} className="flex items-center gap-2.5 px-3 py-2.5">
          <XChip />
          <span className="flex-1 min-w-0 truncate text-[12.5px] text-foreground/85">{r.t}</span>
          <span
            className={`shrink-0 font-mono text-[11px] tabular-nums ${
              r.best ? 'text-[#1B6FC4] font-medium' : r.flop ? 'text-muted-foreground/60' : 'text-muted-foreground'
            }`}
          >
            {r.v}
          </span>
        </div>
      ))}
    </div>
  );
}

function LearnsRules() {
  return (
    <div className="mt-4 rounded-lg border border-[#EFEDE8] p-3.5">
      <p className="text-[12.5px] text-[#B0453B] line-through decoration-[#D2402F]">Ever wondered why your posts flop?</p>
      <p className="mt-1 text-[12.5px] text-foreground/90">my last 12 posts died in the first hour, so i checked why</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {['no question hooks', 'numbers first', 'no em dashes'].map((r) => (
          <span key={r} className="rounded-[4px] border border-[#BEDCF7] bg-[#EAF3FD] px-2 py-1 font-mono text-[10.5px] text-[#1B6FC4]">
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}

function PingsYou() {
  return (
    <div className="mt-4 rounded-lg overflow-hidden border border-[#EFEDE8]">
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-[#EDEFF1]">
        <span className="grid place-items-center size-6 rounded-full bg-gradient-to-b from-[#6EC8F6] to-[#3390EC] text-white text-[11px] font-semibold">
          L
        </span>
        <span className="text-[12.5px] font-semibold text-[#0F1419]">Lore</span>
        <span className="text-[11px] text-[#707991]">bot</span>
      </div>
      <div className="px-2.5 py-3 space-y-1.5 bg-[linear-gradient(160deg,#EEF3F8_0%,#E7EEF6_50%,#EDE9F6_100%)]">
        <div className="max-w-[92%] w-fit rounded-[14px] rounded-bl-[5px] bg-white px-3 py-2 text-[12px] leading-snug text-[#0F1419] shadow-[0_1px_1px_rgba(16,35,47,0.08)]">
          morning. the churn post did 28.7k, 3 drafts are ready. queue one?
        </div>
        <div className="ml-auto max-w-[70%] w-fit rounded-[14px] rounded-br-[5px] bg-[#EFFDDE] px-3 py-2 text-[12px] text-[#0F1419] shadow-[0_1px_1px_rgba(16,35,47,0.08)]">
          yes, the pricing one
        </div>
      </div>
    </div>
  );
}

export function HowItWorks() {
  return (
    <div className="grid md:grid-cols-3 gap-5">
      <div className={CARD}>
        <h3 className="font-semibold tracking-tight">It reads you first</h3>
        <p className="mt-1 text-[14px] text-muted-foreground">90 days of your posts, and what actually landed</p>
        <ReadsYou />
      </div>
      <div className={CARD}>
        <h3 className="font-semibold tracking-tight">Your edits become rules</h3>
        <p className="mt-1 text-[14px] text-muted-foreground">Fix a line once and it never comes back</p>
        <LearnsRules />
      </div>
      <div className={CARD}>
        <h3 className="font-semibold tracking-tight">It finds you on your phone</h3>
        <p className="mt-1 text-[14px] text-muted-foreground">A brief on Telegram, reply and it drafts</p>
        <PingsYou />
      </div>
    </div>
  );
}
