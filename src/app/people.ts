import { extractEmail, extractName } from "../utils";

// How a "Name <email>" address or a bare address reads in a list
export function personName(address: string): string {
  return extractName(address) || extractEmail(address);
}

const isOwn = (address: string, ownEmails: readonly string[]) => {
  const email = extractEmail(address).toLowerCase();
  return ownEmails.some(own => own.toLowerCase() === email);
};

const SHOWN_PARTICIPANTS = 3;

// A thread row's people: "me, Ana Pérez, Jules + 2"
export function participantNames(participants: readonly string[], ownEmails: readonly string[]): string {
  const shown = participants
    .slice(0, SHOWN_PARTICIPANTS)
    .map(p => (isOwn(p, ownEmails) ? "me" : personName(p)))
    .join(", ");
  const rest = participants.length - SHOWN_PARTICIPANTS;
  return rest > 0 ? `${shown} + ${rest}` : shown;
}

// The event organizer is an address; the guest list may know their name
export function organizerName(
  event: {
    organizer: string | null;
    attendees: { email: string; display_name: string | null }[];
  },
  ownEmail?: string,
): string | null {
  if (!event.organizer) return null;
  if (ownEmail && isOwn(event.organizer, [ownEmail])) return "You";
  const email = extractEmail(event.organizer).toLowerCase();
  const guest = event.attendees.find(a => a.email.toLowerCase() === email);
  return guest?.display_name || personName(event.organizer);
}
