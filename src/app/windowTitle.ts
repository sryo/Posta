import type { GoogleCalendarEvent } from "../api/tauri";
import { formatClock } from "./dateFormat";
import { timedEvents, eventEnd } from "./upcoming";

// The native window title never shows in the app (the title bar is an
// overlay), but the Window menu, Mission Control and VoiceOver read it. It
// carries the board's most time-sensitive fact, then the app name.

const APP = "Posta";
const MINUTE_MS = 60_000;
const SOON_MS = 10 * MINUTE_MS;

export interface BoardFacts {
  events: readonly GoogleCalendarEvent[];
  offlineSince: number | null;
  unread: number;
}

function fact({ events, offlineSince, unread }: BoardFacts, now: number, locale?: string): string | null {
  const timed = timedEvents(events);
  const soon = timed.find(e => e.start_time > now && e.start_time - now <= SOON_MS);
  if (soon) {
    const minutes = Math.max(1, Math.ceil((soon.start_time - now) / MINUTE_MS));
    return `${soon.title} in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const current = timed.find(e => e.start_time <= now && now < eventEnd(e));
  if (current) return `${current.title} until ${formatClock(new Date(eventEnd(current)), locale)}`;
  if (offlineSince !== null) return `Offline since ${formatClock(new Date(offlineSince), locale)}`;
  if (unread > 0) return `${unread} unread`;
  return null;
}

export function boardTitle(facts: BoardFacts, now: number, locale?: string): string {
  const said = fact(facts, now, locale);
  return said ? `${said} — ${APP}` : APP;
}

/** Applies the last title asked for once `delayMs` pass without another,
 *  so a sync that moves the unread count several times sets it once */
export function createTitleSync(apply: (title: string) => Promise<void>, delayMs: number) {
  let applied: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (title: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (title === applied) return;
      applied = title;
      Promise.resolve().then(() => apply(title)).catch(() => { applied = null; });
    }, delayMs);
  };
}
