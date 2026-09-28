import { rsvpCalendarEvent } from "../api/tauri";

export type RsvpStatus = "accepted" | "tentative" | "declined";

// The backend looks events up by iCalUID; Google-origin events use
// "<id>@google.com", so retry with that suffix when the bare id misses
export async function rsvpWithFallback(accountId: string, eventId: string, status: RsvpStatus): Promise<void> {
  try {
    await rsvpCalendarEvent(accountId, eventId, status);
  } catch (err) {
    if (!String(err).includes("not found")) throw err;
    await rsvpCalendarEvent(accountId, `${eventId}@google.com`, status);
  }
}

const ANSWER_LABELS: Record<RsvpStatus, string> = { accepted: "Going", tentative: "Maybe", declined: "Not going" };

export function rsvpSentMessage(status: RsvpStatus): string {
  return `RSVP sent: ${ANSWER_LABELS[status]}`;
}

// Whether the calendar event with this id is the one an invite email's
// iCalendar UID names
export function inviteNamesEvent(inviteUid: string, eventId: string): boolean {
  return inviteUid === eventId || inviteUid === `${eventId}@google.com`;
}
