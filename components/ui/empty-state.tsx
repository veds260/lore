import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface ActionConfig {
  label: string;
  href?: string;
  onClick?: () => void;
  loading?: boolean;
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  primary?: ActionConfig;
  secondary?: ActionConfig;
  children?: ReactNode;
  /**
   * - `card`: bordered card, sits inline (default, use inside a section)
   * - `bare`: no border, sits inline
   * - `fullHeight`: vertically centers the empty state in the available viewport.
   *   Use when the empty state is the ONLY thing on the page. Anchors to the
   *   canvas center on wide screens so content doesn't strand top-left.
   */
  variant?: 'card' | 'bare' | 'fullHeight';
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  primary,
  secondary,
  children,
  variant = 'card',
  className = '',
}: EmptyStateProps) {
  if (variant === 'fullHeight') {
    return (
      <div className={`flex items-center justify-center min-h-[60vh] w-full ${className}`}>
        <div className="w-full max-w-md mx-auto">
          <Inner icon={Icon} title={title} description={description} primary={primary} secondary={secondary}>
            {children}
          </Inner>
        </div>
      </div>
    );
  }

  const container = variant === 'card'
    ? 'border border-border rounded-xl bg-card'
    : '';

  return (
    <div className={`${container} ${className}`}>
      <Inner icon={Icon} title={title} description={description} primary={primary} secondary={secondary}>
        {children}
      </Inner>
    </div>
  );
}

function Inner({
  icon: Icon,
  title,
  description,
  primary,
  secondary,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  primary?: ActionConfig;
  secondary?: ActionConfig;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-16">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-5">
        <Icon size={20} strokeWidth={1.6} className="text-muted-foreground" />
      </div>
      <h2 className="text-base font-semibold text-foreground tracking-tight">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground mt-1.5 max-w-sm leading-relaxed">
          {description}
        </p>
      )}
      {(primary || secondary) && (
        <div className="flex items-center gap-2 mt-6">
          {primary && <ActionButton action={primary} kind="primary" />}
          {secondary && <ActionButton action={secondary} kind="secondary" />}
        </div>
      )}
      {children && <div className="mt-6 w-full">{children}</div>}
    </div>
  );
}

function ActionButton({ action, kind }: { action: ActionConfig; kind: 'primary' | 'secondary' }) {
  const base = 'inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md font-medium transition-opacity disabled:opacity-40';
  const cls = kind === 'primary'
    ? `${base} bg-foreground text-background hover:opacity-90`
    : `${base} border border-border text-foreground hover:bg-accent`;

  if (action.href) {
    return (
      <Link href={action.href} className={cls}>
        {action.label}
      </Link>
    );
  }
  return (
    <button onClick={action.onClick} disabled={action.loading} className={cls}>
      {action.label}
    </button>
  );
}
