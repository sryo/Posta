export type RsvpStatus = "accepted" | "tentative" | "declined";

// `key` is the KeyboardEvent.key that answers from the event view or a
// focused invite row; Maybe takes ⇧M because m moves an event
export const RSVP_ANSWERS: readonly {
  status: RsvpStatus;
  label: string;
  tone: "success" | "warning" | "danger";
  key: string;
  keyHint: string;
  ariaKey: string;
}[] = [
  { status: "accepted", label: "Going", tone: "success", key: "y", keyHint: "Y", ariaKey: "y" },
  { status: "tentative", label: "Maybe", tone: "warning", key: "M", keyHint: "⇧M", ariaKey: "Shift+M" },
  { status: "declined", label: "Not going", tone: "danger", key: "n", keyHint: "N", ariaKey: "n" },
];

export function rsvpForKey(e: { key: string }): RsvpStatus | null {
  return RSVP_ANSWERS.find(a => a.key === e.key)?.status ?? null;
}

const SENT_MESSAGES: Record<RsvpStatus, string> = {
  accepted: "You're going",
  tentative: "You said maybe",
  declined: "You're not going",
};

export function rsvpSentMessage(status: RsvpStatus): string {
  return SENT_MESSAGES[status];
}

export function isRsvpAnswer(status: string | null | undefined): status is RsvpStatus {
  return RSVP_ANSWERS.some(a => a.status === status);
}

function answerLabel(status: string | null | undefined): string | null {
  return RSVP_ANSWERS.find(a => a.status === status)?.label ?? null;
}

export function guestResponseLabel(status: string | null | undefined): string {
  return answerLabel(status) ?? "Not answered";
}

export function ownResponseLabel(status: string | null | undefined): string {
  return answerLabel(status) ?? "Going?";
}

// Whether the calendar event with this id is the one an invite email's
// iCalendar UID names
export function inviteNamesEvent(inviteUid: string, eventId: string): boolean {
  return inviteUid === eventId || inviteUid === `${eventId}@google.com`;
}
