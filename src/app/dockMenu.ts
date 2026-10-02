import type { Card, GoogleCalendarEvent } from "../api/tauri";
import { dayOffset, formatClock } from "./dateFormat";
import { timedEvents } from "./upcoming";

// What Posta's right-click Dock menu lists: the cards in board order with
// their unread counts, then the next event when the board has a calendar.
// macOS draws the items; Rust only lays them out.

export interface DockMenu {
  cards: { id: string; title: string }[];
  next: string | null;
}

const MINUTE_MS = 60_000;

function untilLine(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE_MS));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `in ${minutes} min`;
  return rest === 0 ? `in ${hours} h` : `in ${hours} h ${rest} min`;
}

function nextLine(events: readonly GoogleCalendarEvent[], now: number, locale?: string): string {
  const next = timedEvents(events).find(e => e.start_time > now && dayOffset(new Date(e.start_time), new Date(now)) === 0);
  if (!next) return "Nothing else today";
  return `Next: ${next.title}, ${formatClock(new Date(next.start_time), locale)} · ${untilLine(next.start_time - now)}`;
}

export function dockMenu(
  cards: readonly Pick<Card, "id" | "name" | "card_type">[],
  unreadByCard: Readonly<Record<string, number>>,
  events: readonly GoogleCalendarEvent[],
  now: number,
  locale?: string,
): DockMenu {
  return {
    cards: cards.map(({ id, name }) => {
      const unread = unreadByCard[id] ?? 0;
      return { id, title: unread > 0 ? `${name} (${unread})` : name };
    }),
    next: cards.some(c => c.card_type === "calendar") ? nextLine(events, now, locale) : null,
  };
}
