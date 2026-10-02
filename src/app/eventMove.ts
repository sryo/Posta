// Moving an event to another time or day from a calendar card: where it
// lands, whether that time is free, and what the move tells its guests

import type { EventInput, GoogleCalendarEvent } from "../api/tauri";
import { guestsOf } from "./attendance";
import { shortWeekday } from "./dateFormat";
import { eventActions } from "./eventActions";
import { clock, type Gutter } from "./gutters";
import { organizerName } from "./people";

const HOUR_MS = 3_600_000;
const QUARTER_HOUR_MS = 15 * 60_000;

function length(event: GoogleCalendarEvent): number {
  return (event.end_time ?? event.start_time + HOUR_MS) - event.start_time;
}

// The event's start at its own clock time on `day`
export function sameTimeOn(event: GoogleCalendarEvent, day: Date): number {
  const start = new Date(event.start_time);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), start.getHours(), start.getMinutes()).getTime();
}

export function movedTo(event: GoogleCalendarEvent, start: number): { start_time: number; end_time: number } {
  return { start_time: start, end_time: start + length(event) };
}

// Where a free stretch takes an event dropped on it: its start, or the next
// quarter hour once it is under way
export function gutterMoveStart(gutter: Gutter, now: number): number {
  if (gutter.start >= now) return gutter.start;
  return Math.ceil(now / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
}

export interface MoveVerdict {
  free: boolean;
  text: string;
  clash: GoogleCalendarEvent | null;
}

// Whether the event would be free starting at `start`, among the events
// already listed; all-day, declined and cancelled ones take no time
export function moveVerdict(event: GoogleCalendarEvent, start: number, events: GoogleCalendarEvent[], locale?: string): MoveVerdict {
  const end = start + length(event);
  const clash = events
    .filter(e => e.id !== event.id && !e.all_day && e.response_status !== "declined" && e.status !== "cancelled")
    .filter(e => e.start_time < end && (e.end_time ?? e.start_time + HOUR_MS) > start)
    .sort((a, b) => a.start_time - b.start_time)[0];
  if (!clash) return { free: true, text: `${clock(start, locale)} is free`, clash: null };
  return { free: false, text: `clashes with ${clash.title}, ${clock(clash.start_time, locale)}`, clash };
}

// Why the user can't move the event from its row; null when they can
export function moveRefusal(event: GoogleCalendarEvent, accountEmail: string): string | null {
  if (event.all_day) return "Open an all-day event to move it";
  const actions = eventActions(event, accountEmail);
  if (actions.move) return null;
  if (actions.role === "guest") return `Only ${organizerName(event, accountEmail) ?? "the organizer"} can move this`;
  return "You can't change this event";
}

// "Moved Standup to Fri 10:00 · 4 guests get an update"
export function moveToastText(event: GoogleCalendarEvent, start: number, accountEmail: string, clash: GoogleCalendarEvent | null, locale?: string): string {
  const parts = [`Moved ${event.title} to ${shortWeekday(new Date(start), locale)} ${clock(start, locale)}`];
  const guests = eventActions(event, accountEmail).role === "organizer" ? guestsOf(event, accountEmail).length : 0;
  if (guests) parts.push(`${guests} ${guests === 1 ? "guest gets" : "guests get"} an update`);
  if (clash) parts.push(`overlaps ${clash.title}`);
  return parts.join(" · ");
}

// The write that moves it: its own title, notes and place as listed, guests
// and repeats left as they are
export function moveInput(event: GoogleCalendarEvent, start: number): EventInput {
  const { start_time, end_time } = movedTo(event, start);
  return {
    summary: event.title,
    description: event.description,
    location: event.location,
    startTime: start_time,
    endTime: end_time,
    allDay: false,
    attendees: null,
    recurrence: null,
  };
}
