import { extractEmail, extractName } from "../utils";

// How a "Name <email>" address or a bare address reads in a list
export function personName(address: string): string {
  return extractName(address) || extractEmail(address);
}

// The event organizer is an address; the guest list may know their name
export function organizerName(event: {
  organizer: string | null;
  attendees: { email: string; display_name: string | null }[];
}): string | null {
  if (!event.organizer) return null;
  const email = extractEmail(event.organizer).toLowerCase();
  const guest = event.attendees.find(a => a.email.toLowerCase() === email);
  return guest?.display_name || personName(event.organizer);
}
