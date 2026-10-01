import type { GoogleCalendarEvent } from "../api/tauri";

// What the board's calendar cards say is coming up, for places outside a
// card (the window title, the Dock menu)

const DEFAULT_LENGTH_MS = 30 * 60_000;

export function eventEnd(event: Pick<GoogleCalendarEvent, "start_time" | "end_time">): number {
  return event.end_time && event.end_time > event.start_time ? event.end_time : event.start_time + DEFAULT_LENGTH_MS;
}

/** Events with a time that the user is going to, by start time, each once
 *  even when several cards list it */
export function timedEvents(events: readonly GoogleCalendarEvent[]): GoogleCalendarEvent[] {
  const seen = new Set<string>();
  return events
    .filter(e => !e.all_day && e.status !== "cancelled" && e.response_status !== "declined")
    .filter(e => !seen.has(e.id) && !!seen.add(e.id))
    .sort((a, b) => a.start_time - b.start_time);
}
