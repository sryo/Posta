// The postmark an empty card shows: when it emptied, how the stamp looks and
// what it says. A card's stamp keeps its look from one render to the next.

import { uses12HourClock } from "./dateFormat";

export type EmptyKind = "mail" | "calendar";

const MAIL_LINES = ["Nothing left to sort.", "All delivered.", "Pile's empty."];
const EVENING_LINE = "All delivered. See you tomorrow.";
export const EVENING_HOUR = 18;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MAX_TILT = 8;

// FNV-1a: a small stable hash, so a card's tilt and line survive restarts
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function emptyLine(kind: EmptyKind, cardId: string, query: string, clearedAt: Date): string {
  if (kind === "calendar") {
    if (/\bcalendar:tomorrow\b/i.test(query)) return "Tomorrow's free.";
    if (/\bcalendar:(today|0d)\b/i.test(query)) return "Nothing left today.";
    return "Nothing coming up.";
  }
  if (clearedAt.getHours() >= EVENING_HOUR) return EVENING_LINE;
  return MAIL_LINES[hash(cardId) % MAIL_LINES.length];
}

// "2:14" over "PM", or "14:14" alone where the clock runs to 24
export function stampClock(date: Date, locale?: string): { time: string; meridiem: "AM" | "PM" | null } {
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const hours = date.getHours();
  if (!uses12HourClock(locale)) return { time: `${String(hours).padStart(2, "0")}:${minutes}`, meridiem: null };
  return { time: `${hours % 12 || 12}:${minutes}`, meridiem: hours < 12 ? "AM" : "PM" };
}

// "2:14 p.m." or "14:14", for the status label
export function spokenClock(date: Date, locale?: string): string {
  const { time, meridiem } = stampClock(date, locale);
  if (!meridiem) return time;
  return `${time} ${meridiem === "AM" ? "a.m." : "p.m."}`;
}

// "29 SEP 2026", as a franking machine prints it
export function stampDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

// A whole number of degrees in -8..8
export function stampTilt(cardId: string): number {
  return (hash(`tilt:${cardId}`) % (MAX_TILT * 2 + 1)) - MAX_TILT;
}

export function cancellationStyle(date: Date): "waves" | "bars" {
  return date.getDay() % 2 === 0 ? "waves" : "bars";
}

const RING_NAME_MAX = 9;
const RING_FIT = 11;
const RING_FONT_SIZE = 7.5;

export function ringText(name: string): string {
  let upper = name.trim().toUpperCase();
  if (upper.length > RING_NAME_MAX) upper = `${upper.slice(0, RING_NAME_MAX - 1).trimEnd()}…`;
  return `${upper} · POSTA`;
}

// The top arc holds about 11 characters at full size; longer rings shrink
export function ringFontSize(text: string): number {
  return text.length <= RING_FIT ? RING_FONT_SIZE : (RING_FONT_SIZE * RING_FIT) / text.length;
}

export function emptyLabel(name: string, clearedAt: Date, query: string, locale?: string): string {
  const time = spokenClock(clearedAt, locale);
  return `${name} is empty. Cleared at ${time}${time.endsWith(".") ? "" : "."} Query: ${query}`;
}

export type PostmarkLedger = ReturnType<typeof createPostmarkLedger>;

// Remembers, for this session, when each card (under its current query) went
// from showing rows to empty. A card empty from the start is dated by its
// first empty render and its stamp doesn't land.
export function createPostmarkLedger(now: () => Date = () => new Date()) {
  const entries = new Map<string, { hadContent: boolean; clearedAt: Date | null }>();
  const key = (cardId: string, query: string) => `${cardId}\n${query.trim()}`;

  return {
    sawContent(cardId: string, query: string) {
      entries.set(key(cardId, query), { hadContent: true, clearedAt: null });
    },
    emptied(cardId: string, query: string): { clearedAt: Date; lands: boolean } {
      const k = key(cardId, query);
      const entry = entries.get(k);
      if (entry?.clearedAt) return { clearedAt: entry.clearedAt, lands: false };
      const clearedAt = now();
      entries.set(k, { hadContent: false, clearedAt });
      return { clearedAt, lands: entry?.hadContent ?? false };
    },
  };
}
