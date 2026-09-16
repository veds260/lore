const STEPS = ['Create your account', 'Connect a model', 'Start writing'];

export function SetupSteps({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol className="flex items-center gap-2 text-[12px]">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`grid size-5 place-items-center rounded-full text-[11px] font-medium ${
                done ? 'bg-emerald-500 text-white' : active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
              }`}
            >
              {done ? '✓' : i + 1}
            </span>
            <span className={active ? 'text-foreground font-medium' : 'text-muted-foreground hidden sm:inline'}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
