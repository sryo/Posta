// Where a radial menu's petals sit. Angles are degrees, 0 pointing right and
// growing clockwise (screen y grows down), so 90 is straight down.

// A hover menu opens once the pointer rests this long, and closes this long
// after it leaves, so crossing over it or the gap to it doesn't flicker
export const RADIAL_HOVER_OPEN_MS = 150;
export const RADIAL_HOVER_CLOSE_MS = 120;

export type Arc = { start: number; span: number };
export type Rect = { left: number; top: number; right: number; bottom: number };
export type Petal = { angle: number; x: number; y: number };

// Petals may overlap like a flower's, or the ring grows until they just touch
export type Overlap = "allow" | "grow";

const rad = (deg: number) => (deg * Math.PI) / 180;
const round = (n: number) => Math.round(n * 100) / 100;

// Evenly along the arc: a full circle leaves no petal doubled at the seam, and
// a single petal sits in the middle of its arc
export function petalAngles(count: number, arc: Arc): number[] {
  if (count <= 0) return [];
  if (count === 1) return [arc.start + arc.span / 2];
  const full = arc.span >= 360;
  const step = arc.span / (full ? count : count - 1);
  return Array.from({ length: count }, (_, i) => arc.start + i * step);
}

// The radius that keeps neighbouring petal centres `gap` beyond touching,
// never below `radius` nor above `maxRadius`
export function fittedRadius(count: number, arc: Arc, radius: number, itemSize: number, gap: number, maxRadius: number): number {
  if (count < 2) return radius;
  const step = rad(arc.span >= 360 ? arc.span / count : arc.span / (count - 1));
  const needed = (itemSize + gap) / (2 * Math.sin(step / 2));
  return Math.min(Math.max(radius, needed), maxRadius);
}

export function layoutPetals(opts: {
  count: number;
  arc: Arc;
  radius: number;
  itemSize: number;
  overlap?: Overlap;
  gap?: number;
  maxRadius?: number;
}): { radius: number; petals: Petal[] } {
  const radius = opts.overlap === "grow"
    ? fittedRadius(opts.count, opts.arc, opts.radius, opts.itemSize, opts.gap ?? 2, opts.maxRadius ?? opts.radius * 2)
    : opts.radius;
  const petals = petalAngles(opts.count, opts.arc).map(angle => ({
    angle,
    x: round(radius * Math.cos(rad(angle))),
    y: round(radius * Math.sin(rad(angle))),
  }));
  return { radius, petals };
}

// The arc to open toward `toward`, at most `maxSpan` wide, kept to the angles
// where a petal `reach` from the anchor's centre stays inside `bounds`. With
// nothing to measure (no layout yet) it is simply centred on `toward`.
export function autoArc(opts: { anchor: Rect; bounds?: Rect; toward: number; maxSpan: number; reach: number; minSpan?: number }): Arc {
  const centred = { start: opts.toward - opts.maxSpan / 2, span: opts.maxSpan };
  const b = opts.bounds;
  const cx = (opts.anchor.left + opts.anchor.right) / 2;
  const cy = (opts.anchor.top + opts.anchor.bottom) / 2;
  if (!b || b.right - b.left <= 0 || b.bottom - b.top <= 0 || (cx === 0 && cy === 0 && opts.anchor.right === 0)) return centred;

  const STEP = 5;
  const fits = (deg: number) => {
    const x = cx + opts.reach * Math.cos(rad(deg));
    const y = cy + opts.reach * Math.sin(rad(deg));
    return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  };
  const half = opts.maxSpan / 2;
  if (fits(opts.toward - half) && fits(opts.toward + half) && everyFits(opts.toward - half, opts.maxSpan, fits, STEP)) return centred;

  // Grow a window of room around the nearest free direction to `toward`
  let best: Arc | null = null;
  for (let offset = 0; offset <= 180; offset += STEP) {
    for (const dir of offset === 0 ? [opts.toward] : [opts.toward - offset, opts.toward + offset]) {
      if (!fits(dir)) continue;
      let lo = dir;
      let hi = dir;
      while (hi - lo < opts.maxSpan && fits(lo - STEP)) lo -= STEP;
      while (hi - lo < opts.maxSpan && fits(hi + STEP)) hi += STEP;
      const span = Math.min(hi - lo, opts.maxSpan);
      if (!best || span > best.span) best = { start: lo, span };
      if (span >= (opts.minSpan ?? opts.maxSpan)) return best;
    }
    if (best) return best;
  }
  return centred;
}

function everyFits(start: number, span: number, fits: (deg: number) => boolean, step: number): boolean {
  for (let a = start; a <= start + span; a += step) if (!fits(a)) return false;
  return true;
}
