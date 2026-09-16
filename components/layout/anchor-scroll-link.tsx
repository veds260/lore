'use client';

import { useCallback, type AnchorHTMLAttributes, type ReactNode } from 'react';

interface Props extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: `#${string}`;
  children: ReactNode;
}

// Anchor link that always re-scrolls to the target, even when the URL hash
// already matches. Next.js's <Link> (and a plain <a href="#x">) is a no-op
// the second time you click the same anchor, the browser won't fire a
// hashchange and won't re-scroll. This wrapper handles the scroll manually.
export function AnchorScrollLink({ href, children, onClick, ...rest }: Props) {
  const id = href.slice(1);

  const handleClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let modifier-clicks (cmd+click etc.) behave like normal links
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
      onClick?.(e);
      return;
    }
    e.preventDefault();
    onClick?.(e);
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Keep the hash in the URL so deep links still work and back-button history is consistent
    if (window.location.hash !== href) {
      history.replaceState(null, '', href);
    }
  }, [href, id, onClick]);

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
