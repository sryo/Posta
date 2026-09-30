import type { GoogleCalendarEvent } from "../api/tauri";
import { inviteNamesEvent } from "./rsvp";

// The day strip on an unanswered invite: twelve hours of the event's day
// with the invite's slot, the user's other events and a now-line

export type Span = { start: number; end: number };
export type StripEvent = Span & { title: string };
export type Box = { left: number; width: number };

const WINDOW_HOURS = 12;
const DEFAULT_FIRST_HOUR = 8;

function atHour(day: Date, hour: number): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour).getTime();
}

function hourOf(time: number, round: "down" | "up"): number {
  const d = new Date(time);
  const hour = d.getHours();
  const partial = d.getMinutes() > 0 || d.getSeconds() > 0 || d.getMilliseconds() > 0;
  return round === "up" && partial ? hour + 1 : hour;
}

// 8 a.m. to 8 p.m. of the event's day, moved to take in an event outside
// it; never past the day's midnights
export function stripWindow(start: number, end: number): Span {
  const day = new Date(start);
  const defaultStart = atHour(day, DEFAULT_FIRST_HOUR);
  const defaultEnd = atHour(day, DEFAULT_FIRST_HOUR + WINDOW_HOURS);
  if (start < defaultStart || end - start >= WINDOW_HOURS * 3_600_000) {
    const first = hourOf(start, "down");
    return { start: atHour(day, first), end: atHour(day, Math.min(first + WINDOW_HOURS, 24)) };
  }
  if (end > defaultEnd) {
    const sameDay = new Date(end).getDate() === day.getDate();
    const last = sameDay ? Math.min(hourOf(end, "up"), 24) : 24;
    return { start: atHour(day, last - WINDOW_HOURS), end: atHour(day, last) };
  }
  return { start: defaultStart, end: defaultEnd };
}

// Events that overlap the slot; touching at an edge is not a clash
export function clashesWith<E extends Span>(slot: Span, events: E[]): E[] {
  return events.filter(e => e.start < slot.end && slot.start < e.end && e.end > e.start);
}

// The user's other timed events that day: not the invite's own event (or an
// occurrence of it), nothing declined or cancelled, no all-day events
export function dayOtherEvents(
  events: GoogleCalendarEvent[],
  invite: Span & { uid: string | null },
): StripEvent[] {
  const day = new Date(invite.start);
  const dayStart = atHour(day, 0);
  const dayEnd = atHour(day, 24);
  const own = (e: GoogleCalendarEvent) =>
    !!invite.uid && (inviteNamesEvent(invite.uid, e.id) || (!!e.recurring_event_id && inviteNamesEvent(invite.uid, e.recurring_event_id)));
  return events
    .filter(e => !e.all_day && !own(e) && e.response_status !== "declined" && e.status?.toLowerCase() !== "cancelled")
    .map(e => ({ title: e.title, start: e.start_time, end: e.end_time ?? e.start_time }))
    .filter(e => e.start < dayEnd && (e.end > dayStart || (e.end === e.start && e.start >= dayStart)));
}

export type StripLayout = {
  window: Span;
  slot: Box;
  busy: (Box & { title: string; overlap: boolean })[];
  clashes: StripEvent[];
  noonAt: number | null;
  nowAt: number | null;
  past: number | null;
};

export function stripLayout(slot: Span, others: StripEvent[], now: number): StripLayout {
  const window = stripWindow(slot.start, slot.end);
  const length = window.end - window.start;
  const pct = (t: number) => ((Math.min(Math.max(t, window.start), window.end) - window.start) / length) * 100;
  const box = (span: Span): Box => ({ left: pct(span.start), width: pct(span.end) - pct(span.start) });
  const clashes = clashesWith(slot, others);
  const busy = others
    .filter(e => e.end > window.start && e.start < window.end)
    .map(e => ({ ...box(e), title: e.title, overlap: clashes.includes(e) }));
  const noon = (atHour(new Date(window.start), 12) - window.start) / length * 100;
  const nowInWindow = now >= window.start && now <= window.end;
  return {
    window,
    slot: box(slot),
    busy,
    clashes,
    noonAt: noon > 0 && noon < 100 ? noon : null,
    nowAt: nowInWindow ? pct(now) : null,
    past: nowInWindow ? pct(now) : null,
  };
}

const LABEL_EVERY_HOURS = 3;

// Hour labels under a strip, every three hours across its window, in percent
export function stripHours(window: Span, label: (hour: number) => string): { at: number; label: string }[] {
  const length = window.end - window.start;
  const first = new Date(window.start).getHours();
  const hours = Math.round(length / 3_600_000);
  const out: { at: number; label: string }[] = [];
  for (let h = 0; h <= hours; h += LABEL_EVERY_HOURS) out.push({ at: (h / hours) * 100, label: label((first + h) % 24) });
  return out;
}
