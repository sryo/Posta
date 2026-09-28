import type { GoogleCalendarEvent } from "../api/tauri";

type EventPeople = Pick<GoogleCalendarEvent, "organizer" | "attendees">;

// Who a reply to an event goes to. The organizer, unless that is the user:
// then the other guests, since mailing oneself is never the intent.
export function eventReplyRecipients(event: EventPeople, accountEmail: string, all = false): { to: string; cc: string } {
  const self = accountEmail.toLowerCase();
  const organizer = event.organizer?.trim() || null;
  const organizerIsSelf = !organizer
    || organizer.toLowerCase() === self
    || event.attendees.some(a => a.is_self && a.is_organizer);

  const seen = new Set<string>([self]);
  if (organizer) seen.add(organizer.toLowerCase());
  const guests: string[] = [];
  for (const a of event.attendees) {
    const email = a.email.toLowerCase();
    if (a.is_self || seen.has(email)) continue;
    seen.add(email);
    guests.push(a.email);
  }

  if (organizerIsSelf) return { to: guests.join(", "), cc: "" };
  return { to: organizer!, cc: all ? guests.join(", ") : "" };
}
