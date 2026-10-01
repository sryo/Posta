import type { GoogleCalendarEvent } from "../api/tauri";

type EventFacts = Pick<GoogleCalendarEvent, "organizer" | "attendees" | "can_edit" | "hangout_link" | "html_link" | "response_status">;

// owner: the user's own event with no one else on it; organizer: the user's
// event with guests; guest: someone else's event the user is on or can see
export type EventRole = "owner" | "organizer" | "guest";

export interface EventActions {
  role: EventRole;
  rsvp: boolean;
  reply: boolean;
  emailGuests: boolean;
  join: boolean;
  open: boolean;
  move: boolean;
  edit: boolean;
  delete: boolean;
  // Guests other than the user, who hear about a change the organizer makes
  guestCount: number;
}

// What the user can do with an event, shared by the actions wheel, the event
// view and the invite block, so each shows the same choices for one event
export function eventActions(event: EventFacts, accountEmail: string): EventActions {
  const self = accountEmail.toLowerCase();
  const organizer = event.organizer?.trim().toLowerCase() || null;
  const selfAttendee = event.attendees.find(a => a.is_self || a.email.toLowerCase() === self);
  const organizerIsSelf = organizer === self || !!selfAttendee?.is_organizer || (!organizer && !selfAttendee);
  const manages = organizerIsSelf || (event.can_edit && !selfAttendee);

  const guestCount = event.attendees.filter(a => {
    const email = a.email.toLowerCase();
    return !a.is_self && email !== self && !(organizerIsSelf && a.is_organizer);
  }).length;

  const role: EventRole = !manages ? "guest" : guestCount > 0 ? "organizer" : "owner";
  const common = { role, guestCount, join: !!event.hangout_link, open: !!event.html_link };

  if (role === "guest") {
    return {
      ...common,
      rsvp: !!selfAttendee || event.response_status !== null,
      reply: !!organizer,
      emailGuests: false,
      move: false,
      edit: false,
      delete: false,
    };
  }
  return {
    ...common,
    rsvp: false,
    reply: false,
    emailGuests: role === "organizer",
    move: event.can_edit,
    edit: event.can_edit,
    delete: event.can_edit,
  };
}

export function deletePrompt(actions: Pick<EventActions, "role" | "guestCount">): string {
  if (actions.role !== "organizer") return "Delete event?";
  return `Delete and notify ${actions.guestCount} ${actions.guestCount === 1 ? "guest" : "guests"}?`;
}

export function isWritableCalendar(calendar: { access_role: string }): boolean {
  return calendar.access_role === "owner" || calendar.access_role === "writer";
}

const HOUR_MS = 60 * 60 * 1000;

// Past its end, nothing is left to join: an event without an end runs an hour,
// or the day when it is all day
export function meetingOver(event: Pick<GoogleCalendarEvent, "start_time" | "end_time" | "all_day">, now: number): boolean {
  const end = event.end_time ?? event.start_time + (event.all_day ? 24 : 1) * HOUR_MS;
  return now >= end;
}
