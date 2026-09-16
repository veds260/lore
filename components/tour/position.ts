// Shared positioning logic for tour tooltips. Used by ProductTour and DrawerCoachmarks.
//
// Goals:
//  1. Scroll the target into view before measuring (otherwise tooltips land on stale rects)
//  2. Pick a side that actually has room. If the preferred side would clip, flip
//  3. Clamp the tooltip on all 4 edges with an 8px gutter so it never overflows

export type TipPosition = 'top' | 'right' | 'bottom' | 'left';
export type Rect = { top: number; left: number; width: number; height: number };

const GUTTER = 8;
const ESTIMATED_HEIGHT = 180; // worst-case tooltip height; only used for fit checks

interface ResolveOpts {
  rect: Rect;
  preferred: TipPosition;
  tooltipWidth: number;
  margin: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface Resolved {
  position: TipPosition;
  style: React.CSSProperties;
}

// Scroll the target into view, smoothly, so it sits roughly in the middle of the
// visible scroll container. Safe to call repeatedly. Returns a Promise that resolves
// once the scroll settles (best-effort, uses a short timeout fallback).
export function scrollTargetIntoView(selector: string): Promise<void> {
  return new Promise(resolve => {
    if (typeof document === 'undefined') return resolve();
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return resolve();

    // Already comfortably visible
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const inViewport =
      r.top >= 60 && r.bottom <= vh - 60 && r.left >= 0 && r.right <= vw;
    if (inViewport) return resolve();

    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    // Browser doesn't fire a reliable scrollend, so wait a moderate window
    setTimeout(resolve, 360);
  });
}

// Pick a side that actually fits. Falls through preferred → opposite → top → bottom.
export function resolveTooltipPosition(opts: ResolveOpts): Resolved {
  const { rect, preferred, tooltipWidth, margin, viewportWidth, viewportHeight } = opts;

  // Does the chosen side actually have room for the tooltip?
  const fits = (side: TipPosition): boolean => {
    switch (side) {
      case 'left':   return rect.left >= tooltipWidth + margin + GUTTER;
      case 'right':  return viewportWidth - (rect.left + rect.width) >= tooltipWidth + margin + GUTTER;
      case 'top':    return rect.top >= ESTIMATED_HEIGHT + margin + GUTTER;
      case 'bottom': return viewportHeight - (rect.top + rect.height) >= ESTIMATED_HEIGHT + margin + GUTTER;
    }
  };

  const opposite: Record<TipPosition, TipPosition> = {
    left: 'right', right: 'left', top: 'bottom', bottom: 'top',
  };

  let position: TipPosition = preferred;
  if (!fits(position)) {
    if (fits(opposite[position])) position = opposite[position];
    else if (fits('bottom')) position = 'bottom';
    else if (fits('top')) position = 'top';
    // else: fall through with preferred, it gets clamped into the gutter anyway
  }

  // Compute initial coords based on resolved side
  let top: number;
  let left: number;
  let transform: string | undefined;

  switch (position) {
    case 'right':
      top = rect.top + rect.height / 2;
      left = rect.left + rect.width + margin;
      transform = 'translateY(-50%)';
      break;
    case 'left':
      top = rect.top + rect.height / 2;
      left = rect.left - tooltipWidth - margin;
      transform = 'translateY(-50%)';
      break;
    case 'bottom':
      top = rect.top + rect.height + margin;
      left = rect.left + rect.width / 2 - tooltipWidth / 2;
      transform = undefined; // already offset by width/2
      break;
    case 'top':
      // For top, we want the tooltip's BOTTOM edge `margin` above the target's top.
      // We don't know exact height, so use translateY(-100%) to anchor by bottom.
      top = rect.top - margin;
      left = rect.left + rect.width / 2 - tooltipWidth / 2;
      transform = 'translateY(-100%)';
      break;
  }

  // Clamp horizontally with gutter
  if (left < GUTTER) left = GUTTER;
  if (left + tooltipWidth > viewportWidth - GUTTER) left = viewportWidth - tooltipWidth - GUTTER;

  // Clamp vertically with gutter, only for non-top positions. Top is bottom-anchored
  // so we clamp differently (push down if it would overflow above).
  if (position === 'top') {
    // After translateY(-100%), the tooltip occupies [top - height, top]. If top - estHeight < gutter,
    // shift the anchor down so the top edge ends up at gutter.
    if (top < ESTIMATED_HEIGHT + GUTTER) top = ESTIMATED_HEIGHT + GUTTER;
  } else if (position === 'bottom') {
    if (top + ESTIMATED_HEIGHT > viewportHeight - GUTTER) {
      top = viewportHeight - ESTIMATED_HEIGHT - GUTTER;
    }
  } else {
    // left / right: clamp the vertical center
    if (top < ESTIMATED_HEIGHT / 2 + GUTTER) top = ESTIMATED_HEIGHT / 2 + GUTTER;
    if (top > viewportHeight - ESTIMATED_HEIGHT / 2 - GUTTER) {
      top = viewportHeight - ESTIMATED_HEIGHT / 2 - GUTTER;
    }
  }

  return {
    position,
    style: { top, left, transform },
  };
}
