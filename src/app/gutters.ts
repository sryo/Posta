// The gutters a today or tomorrow calendar card shows: free stretches of the
// working day, like the blank strip between two panes of a stamp sheet.
//
// The working day starts at its first busy event (nothing marks the morning
// before it) and ends at 6 PM. All-day, declined and cancelled events take no
// time; overlapping events count as one stretch from the first start to the
// last end.

import type { GoogleCalendarEvent } from "../api/tauri";
import { EVENING_HOUR, stampClock } from "./postmark";

const MIN_GAP_MINUTES = 90;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const NOON = 12;

export interface Gutter {
  // The row the gutter sits above, by index in the day's events; the events'
  // length puts it after the last row
  beforeIndex: number;
  start: number;
  end: number;
  // Runs on to the end of the working day
  ending: boolean;
  // How far through the gap now is, 0..1, while it is inside one between events
  nowAt: number | null;
}

function busy(event: GoogleCalendarEvent): boolean {
  return !event.all_day && event.response_status !== "declined" && event.status !== "cancelled";
}

// `events` are one day's, in the order the card lists them
export function dayGutters(events: GoogleCalendarEvent[], day: Date, now: number): Gutter[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), EVENING_HOUR).getTime();

  const spans = events
    .filter(busy)
    .map(e => ({ start: e.start_time, end: e.end_time ?? e.start_time + HOUR_MS }))
    .filter(s => s.end > s.start && s.end > dayStart && s.start < dayEnd)
    .sort((a, b) => a.start - b.start);

  const gutters: Gutter[] = [];
  let busyUntil = -Infinity;
  for (let i = 0; i <= spans.length; i++) {
    const next = spans[i];
    if (i > 0 && (!next || next.start > busyUntil)) {
      const start = Math.max(busyUntil, dayStart);
      const end = next ? next.start : dayEnd;
      if (end - start >= MIN_GAP_MINUTES * MINUTE_MS && now < end) {
        const beforeIndex = events.findIndex(e => !e.all_day && e.start_time >= start);
        const ending = !next;
        gutters.push({
          beforeIndex: beforeIndex < 0 ? events.length : beforeIndex,
          start,
          end,
          ending,
          nowAt: !ending && now >= start ? (now - start) / (end - start) : null,
        });
      }
    }
    if (next) busyUntil = Math.max(busyUntil, next.end);
  }
  return gutters;
}

// "half an hour", "an hour and 20 minutes", "2 and a half hours": rounded to
// five minutes, except the last few
export function spokenDuration(minutes: number): string {
  const rounded = minutes < 5 ? minutes : Math.round(minutes / 5) * 5;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) {
    if (m === 30) return "half an hour";
    return m === 1 ? "a minute" : `${m} minutes`;
  }
  const hours = h === 1 ? "an hour" : `${h} hours`;
  if (m === 0) return hours;
  if (m === 30) return h === 1 ? "an hour and a half" : `${h} and a half hours`;
  return `${hours} and ${m} minutes`;
}

function clock(ms: number, locale?: string): string {
  const { time, meridiem } = stampClock(new Date(ms), locale);
  return meridiem ? `${time} ${meridiem}` : time;
}

export function gutterText(gutter: Gutter, now: number, locale?: string): { line: string; length: string | null } {
  if (gutter.ending) {
    return { line: new Date(gutter.start).getHours() >= NOON ? "Afternoon's free." : "Rest of the day's free.", length: null };
  }
  if (now >= gutter.start) {
    return { line: `Free until ${clock(gutter.end, locale)}`, length: `${spokenDuration(Math.ceil((gutter.end - now) / MINUTE_MS))} left` };
  }
  const from = stampClock(new Date(gutter.start), locale);
  const to = stampClock(new Date(gutter.end), locale);
  // "12:00 – 3:30 PM", the meridiem said once when both ends share it
  const fromText = from.meridiem && from.meridiem !== to.meridiem ? `${from.time} ${from.meridiem}` : from.time;
  return {
    line: `Free ${fromText} – ${clock(gutter.end, locale)}`,
    length: spokenDuration(Math.round((gutter.end - gutter.start) / MINUTE_MS)),
  };
}

// The day a card's gutters belong to: today or tomorrow, from its range
export function gutterDay(query: string, now: Date): Date | null {
  const match = /\bcalendar:(today|tomorrow)\b/i.exec(query);
  if (!match) return null;
  const offset = match[1].toLowerCase() === "tomorrow" ? 1 : 0;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
}

// What a today card says of the day around now, beside its gutters: the first
// one of the morning, the last one, and the day being over
export interface DayNote {
  // As a gutter's: the row the note sits above
  beforeIndex: number;
  kind: "first" | "last" | "nothingElse" | "dayDone";
  // The first one's start, or tomorrow's first start once the day is done
  at: number | null;
}

const FIRST_NOTE_LEAD_MS = HOUR_MS;
const DAY_DONE_HOUR = 17;

function timedSpansOn(events: GoogleCalendarEvent[], dayStart: number, nextDayStart: number) {
  return events
    .filter(busy)
    .map(e => ({ start: e.start_time, end: e.end_time ?? e.start_time + HOUR_MS }))
    .filter(s => s.end > dayStart && s.start < nextDayStart);
}

// When the day's first timed event that is on starts; null when none does
export function firstStartOn(events: GoogleCalendarEvent[], day: Date): number | null {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const nextDayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const starts = events.filter(busy).map(e => e.start_time).filter(t => t >= dayStart && t < nextDayStart);
  return starts.length ? Math.min(...starts) : null;
}

function dayNotes(events: GoogleCalendarEvent[], day: Date, now: number, tomorrowStart: number | null, gutters: Gutter[]): DayNote[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const nextDayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  if (now < dayStart || now >= nextDayStart) return [];
  const spans = timedSpansOn(events, dayStart, nextDayStart);
  if (!spans.length) return [];

  const firstStart = Math.min(...spans.map(s => s.start));
  if (firstStart > now) {
    if (firstStart - now < FIRST_NOTE_LEAD_MS) return [];
    const beforeIndex = events.findIndex(e => !e.all_day && e.start_time >= firstStart);
    return [{ beforeIndex: beforeIndex < 0 ? events.length : beforeIndex, kind: "first", at: firstStart }];
  }
  if (spans.some(s => s.start > now)) return [];

  const lastEnd = Math.max(...spans.map(s => s.end));
  const beforeIndex = events.length;
  if (now >= lastEnd && new Date(now).getHours() >= DAY_DONE_HOUR) return [{ beforeIndex, kind: "dayDone", at: tomorrowStart }];
  if (gutters.some(g => g.ending)) return [];
  return [{ beforeIndex, kind: now < lastEnd ? "last" : "nothingElse", at: null }];
}

// A today or tomorrow card's gutters and, while noticing is on, its notes; a
// closed day's note takes the place of a free end of the day
export function calendarDayMarks(
  events: GoogleCalendarEvent[],
  day: Date,
  now: number,
  options: { tomorrowStart: number | null; notices: boolean },
): { gutters: Gutter[]; notes: DayNote[] } {
  const gutters = dayGutters(events, day, now);
  if (!options.notices) return { gutters, notes: [] };
  const notes = dayNotes(events, day, now, options.tomorrowStart, gutters);
  const closed = notes.some(n => n.kind === "dayDone");
  return { gutters: closed ? gutters.filter(g => !g.ending) : gutters, notes };
}

export function dayNoteText(note: DayNote, locale?: string): string {
  switch (note.kind) {
    case "first": return `First one at ${clock(note.at!, locale)}`;
    case "last": return "Last one today";
    case "nothingElse": return "Nothing else today";
    case "dayDone": return note.at === null ? "That's it for today." : `That's it for today. Tomorrow starts at ${clock(note.at, locale)}.`;
  }
}
