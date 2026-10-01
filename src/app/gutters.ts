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

// "3 h 30 m", "2 h", "45 m"
function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : "", m ? `${m} m` : ""].filter(Boolean).join(" ");
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
    return { line: `Free until ${clock(gutter.end, locale)}`, length: `${duration(Math.ceil((gutter.end - now) / MINUTE_MS))} left` };
  }
  const from = stampClock(new Date(gutter.start), locale);
  const to = stampClock(new Date(gutter.end), locale);
  // "12:00 – 3:30 PM", the meridiem said once when both ends share it
  const fromText = from.meridiem && from.meridiem !== to.meridiem ? `${from.time} ${from.meridiem}` : from.time;
  return {
    line: `Free ${fromText} – ${clock(gutter.end, locale)}`,
    length: duration(Math.round((gutter.end - gutter.start) / MINUTE_MS)),
  };
}

// The day a card's gutters belong to: today or tomorrow, from its range
export function gutterDay(query: string, now: Date): Date | null {
  const match = /\bcalendar:(today|tomorrow)\b/i.exec(query);
  if (!match) return null;
  const offset = match[1].toLowerCase() === "tomorrow" ? 1 : 0;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
}
