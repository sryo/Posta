import { describe, expect, it } from "vitest";
import { inviteNamesEvent, rsvpSentMessage } from "./rsvp";

describe("rsvpSentMessage", () => {
  it("says the answer in the words the calendar cards use", () => {
    expect(rsvpSentMessage("accepted")).toBe("RSVP sent: Going");
    expect(rsvpSentMessage("tentative")).toBe("RSVP sent: Maybe");
    expect(rsvpSentMessage("declined")).toBe("RSVP sent: Not going");
  });
});

describe("inviteNamesEvent", () => {
  it("matches a calendar event to an invite's UID", () => {
    expect(inviteNamesEvent("ev1@google.com", "ev1")).toBe(true);
    expect(inviteNamesEvent("abc-123", "abc-123")).toBe(true);
    expect(inviteNamesEvent("ev1@google.com", "ev2")).toBe(false);
  });
});
