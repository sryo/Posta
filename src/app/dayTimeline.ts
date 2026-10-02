// The event form's day timeline: twelve hours of the chosen day, where the
// new event is a block placed, moved and resized in 15-minute steps. Times
// are minutes from the day's midnight.

export type MinuteSpan = { start: number; end: number };
export type Drag = "move" | "start" | "end" | "draw";

export const SNAP_MINUTES = 15;
export const VISIBLE_HOURS = 12;
const DAY_MINUTES = 24 * 60;
const DEFAULT_FIRST_HOUR = 8;
const LAST_FIRST_HOUR = 24 - VISIBLE_HOURS;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

// To the nearest `step` minutes; a step of 0 leaves minutes as they are
export function snap(minutes: number, step = SNAP_MINUTES): number {
  return step > 0 ? Math.round(minutes / step) * step : minutes;
}

// The first hour shown: `current` while the slot fits in view, else the
// nearest hour that takes it in, starting from 8 a.m.
export function firstHourFor(slot: MinuteSpan, current: number = DEFAULT_FIRST_HOUR): number {
  const viewStart = current * 60;
  const viewEnd = viewStart + VISIBLE_HOURS * 60;
  if (slot.start >= viewStart && slot.end <= viewEnd) return current;
  if (slot.start < viewStart || slot.end - slot.start >= VISIBLE_HOURS * 60) {
    return clamp(Math.floor(slot.start / 60), 0, LAST_FIRST_HOUR);
  }
  return clamp(Math.ceil(slot.end / 60) - VISIBLE_HOURS, 0, LAST_FIRST_HOUR);
}

export function panFirstHour(current: number, hours: number): number {
  return clamp(current + hours, 0, LAST_FIRST_HOUR);
}

// The minute under a point `fraction` of the way across the view, snapped
// to `step`
export function minuteAt(fraction: number, firstHour: number, step = SNAP_MINUTES): number {
  return clamp(snap(firstHour * 60 + clamp(fraction, 0, 1) * VISIBLE_HOURS * 60, step), 0, DAY_MINUTES);
}

// Where a view position falls, as a percentage, clamped to the view
export function percentOf(minutes: number, firstHour: number): number {
  return clamp((minutes - firstHour * 60) / (VISIBLE_HOURS * 60), 0, 1) * 100;
}

// The slot while dragging from `anchor` to `at`: moved whole, by one edge, or
// drawn anew, snapped to `step` (0 to follow the pointer exactly); never
// shorter than a step, never off the day
export function dragTo(kind: Drag, origin: MinuteSpan, anchor: number, at: number, step = SNAP_MINUTES): MinuteSpan {
  switch (kind) {
    case "move": {
      const length = origin.end - origin.start;
      const start = clamp(origin.start + snap(at - anchor, step), 0, DAY_MINUTES - length);
      return { start, end: start + length };
    }
    case "start":
      return { start: clamp(snap(at, step), 0, origin.end - SNAP_MINUTES), end: origin.end };
    case "end":
      return { start: origin.start, end: clamp(snap(at, step), origin.start + SNAP_MINUTES, DAY_MINUTES) };
    case "draw": {
      const a = snap(anchor, step);
      const b = snap(at, step);
      const start = clamp(Math.min(a, b), 0, DAY_MINUTES - SNAP_MINUTES);
      return { start, end: clamp(Math.max(a, b, start + SNAP_MINUTES), start + SNAP_MINUTES, DAY_MINUTES) };
    }
  }
}

// The slot, keeping its length, starting at `minute`
export function placeAt(slot: MinuteSpan, minute: number): MinuteSpan {
  return dragTo("move", slot, slot.start, snap(minute));
}

// A step earlier or later, or with `resize` a step shorter or longer
export function nudge(slot: MinuteSpan, steps: number, resize = false): MinuteSpan {
  const delta = steps * SNAP_MINUTES;
  return resize
    ? dragTo("end", slot, slot.end, slot.end + delta)
    : dragTo("move", slot, slot.start, slot.start + delta);
}

// "45 min", "1 hr", "1 hr 30 min"
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

// What the timeline knows of the user's other events that day: the events,
// or that they are still being read, or that they can't be read that far
export type DayBusy = { title: string; start: number; end: number }[] | "loading" | "unavailable";
