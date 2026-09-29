type Rect = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };

const GAP = 8;
const EDGE = 8;

// Viewport coordinates for a fixed popover opened from `anchor`: below it when
// it fits, otherwise above, always inside the window.
export function placeBelowAnchor(anchor: Rect, size: Size, viewport: Size): { top: number; left: number } {
  const left = Math.max(EDGE, Math.min(anchor.left, viewport.width - size.width - EDGE));
  const below = anchor.bottom + GAP;
  const top = below + size.height <= viewport.height - EDGE
    ? below
    : Math.max(EDGE, anchor.top - GAP - size.height);
  return { top, left };
}
