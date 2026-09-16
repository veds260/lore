'use client';

export function LoreLogo({ size = 'md', white = false }: { size?: 'sm' | 'md' | 'lg'; white?: boolean }) {
  const sizes = { sm: 'text-base', md: 'text-xl', lg: 'text-2xl' };
  return (
    <span className={`font-bold tracking-tight ${sizes[size]} ${white ? 'text-white' : 'text-foreground'}`}>
      lore<span className={white ? 'text-white/60' : 'text-primary'}>.</span>
    </span>
  );
}
