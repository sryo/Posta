export type RsvpStatus = "accepted" | "tentative" | "declined";

const ANSWER_LABELS: Record<RsvpStatus, string> = { accepted: "Going", tentative: "Maybe", declined: "Not going" };

export function rsvpSentMessage(status: RsvpStatus): string {
  return `RSVP sent: ${ANSWER_LABELS[status]}`;
}

// Whether the calendar event with this id is the one an invite email's
// iCalendar UID names
export function inviteNamesEvent(inviteUid: string, eventId: string): boolean {
  return inviteUid === eventId || inviteUid === `${eventId}@google.com`;
}
