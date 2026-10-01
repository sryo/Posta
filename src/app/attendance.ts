// Who is coming to an event, from the guest list the event already carries

import type { GoogleCalendarEvent } from "../api/tauri";
import type { ConfirmOptions } from "./confirm";
import { eventActions } from "./eventActions";

type Attendee = GoogleCalendarEvent["attendees"][number];

// A meeting room or other resource booked on the event; it never answers
export function isRoom(attendee: Pick<Attendee, "email">): boolean {
  return attendee.email.toLowerCase().endsWith("@resource.calendar.google.com");
}

// The people on the event besides the user
export function guestsOf(event: Pick<GoogleCalendarEvent, "attendees">, accountEmail: string): Attendee[] {
  const self = accountEmail.toLowerCase();
  return event.attendees.filter(a => !a.is_self && a.email.toLowerCase() !== self && !isRoom(a));
}

export interface Alone {
  role: "guest" | "organizer";
  // How many others declined
  guests: number;
}

// Everyone else on an upcoming event the user still means to attend has
// declined. An event whose guest list is hidden lists no one, so never.
export function aloneAt(event: GoogleCalendarEvent, accountEmail: string, now: number): Alone | null {
  if (event.status === "cancelled" || event.all_day || event.response_status === "declined" || now >= event.start_time) return null;
  const others = guestsOf(event, accountEmail);
  if (!others.length || others.some(a => a.response_status !== "declined")) return null;
  const role = eventActions(event, accountEmail).role === "organizer" ? "organizer" : "guest";
  return { role, guests: others.length };
}

export function aloneText(alone: Alone): string {
  if (alone.role === "guest") return "Everyone else declined";
  if (alone.guests === 1) return "Your guest declined";
  if (alone.guests === 2) return "Both guests declined";
  return `All ${alone.guests} guests declined`;
}

export function cancelPrompt(guests: number): ConfirmOptions {
  return {
    title: `Cancel and notify ${guests} ${guests === 1 ? "guest" : "guests"}?`,
    message: "Each guest gets an email saying the event was cancelled.",
    confirmLabel: "Cancel event",
    cancelLabel: "Keep it",
    tone: "danger",
  };
}
