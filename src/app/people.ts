import { extractEmail, extractName } from "../utils";

// How a "Name <email>" address or a bare address reads in a list
export function personName(address: string): string {
  return extractName(address) || extractEmail(address);
}

// Senders that aren't a person: their mailbox name says nothing, the domain does
const ROBOT = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply)|^(notifications?|info|mailer(-daemon)?|news(letter)?|hello|support|alerts?|updates?|bounces?)$/i;

// How an address reads in a row: the name, else the part before @ for a
// person ("ana.perez") or the domain for a robot ("fullgestion.com.ar")
export function shortName(address: string): string {
  const name = extractName(address);
  if (name) return name;
  const email = extractEmail(address);
  const at = email.lastIndexOf("@");
  if (at < 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).replace(/^(www|mail|email|e|m|mailer|notify|notifications)\./i, "");
  return ROBOT.test(local) ? domain : local;
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
    .map(p => (isOwn(p, ownEmails) ? "me" : shortName(p)))
    .join(", ");
  const rest = participants.length - SHOWN_PARTICIPANTS;
  return rest > 0 ? `${shown} + ${rest}` : shown;
}

// The display name loaded mail gives an address, if any
export function nameInThreads(email: string, threads: Iterable<{ participants: readonly string[] }>): string | undefined {
  const wanted = email.toLowerCase();
  for (const thread of threads) {
    for (const participant of thread.participants) {
      const name = extractName(participant);
      if (name && extractEmail(participant).toLowerCase() === wanted) return name;
    }
  }
  return undefined;
}

// The event organizer is an address; the guest list, or else the user's
// mail, may know their name
export function organizerName(
  event: {
    organizer: string | null;
    attendees: { email: string; display_name: string | null }[];
  },
  ownEmail?: string,
  nameForEmail?: (email: string) => string | undefined,
): string | null {
  if (!event.organizer) return null;
  if (ownEmail && isOwn(event.organizer, [ownEmail])) return "You";
  const email = extractEmail(event.organizer).toLowerCase();
  const guest = event.attendees.find(a => a.email.toLowerCase() === email);
  return guest?.display_name || extractName(event.organizer) || nameForEmail?.(email) || email;
}
