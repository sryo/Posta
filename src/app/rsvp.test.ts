import { describe, expect, it } from "vitest";
import { guestResponseLabel, inviteNamesEvent, isRsvpAnswer, ownResponseLabel, rsvpForKey, rsvpSentMessage, RSVP_ANSWERS } from "./rsvp";

describe("rsvpSentMessage", () => {
  it("confirms the answer in the user's own words", () => {
    expect(rsvpSentMessage("accepted")).toBe("You're going");
    expect(rsvpSentMessage("tentative")).toBe("You said maybe");
    expect(rsvpSentMessage("declined")).toBe("You're not going");
  });
});

describe("RSVP vocabulary", () => {
  it("offers the three answers as Going / Maybe / Not going", () => {
    expect(RSVP_ANSWERS.map(a => [a.status, a.label])).toEqual([
      ["accepted", "Going"],
      ["tentative", "Maybe"],
      ["declined", "Not going"],
    ]);
  });

  it("words another guest's answer, and their silence", () => {
    expect(guestResponseLabel("accepted")).toBe("Going");
    expect(guestResponseLabel("tentative")).toBe("Maybe");
    expect(guestResponseLabel("declined")).toBe("Not going");
    expect(guestResponseLabel("needsAction")).toBe("Not answered");
    expect(guestResponseLabel(null)).toBe("Not answered");
  });

  it("asks the user when they haven't answered yet", () => {
    expect(ownResponseLabel("needsAction")).toBe("Going?");
    expect(ownResponseLabel(null)).toBe("Going?");
    expect(ownResponseLabel("accepted")).toBe("Going");
    expect(ownResponseLabel("declined")).toBe("Not going");
  });
});

describe("isRsvpAnswer", () => {
  it("tells an answer from no answer yet", () => {
    expect(isRsvpAnswer("declined")).toBe(true);
    expect(isRsvpAnswer("needsAction")).toBe(false);
    expect(isRsvpAnswer(null)).toBe(false);
  });
});

describe("rsvpForKey", () => {
  it("answers y, ⇧M and n", () => {
    expect(rsvpForKey({ key: "y" })).toBe("accepted");
    expect(rsvpForKey({ key: "M" })).toBe("tentative");
    expect(rsvpForKey({ key: "n" })).toBe("declined");
    expect(rsvpForKey({ key: "m" })).toBeNull();
  });
});

describe("inviteNamesEvent", () => {
  it("matches a calendar event to an invite's UID", () => {
    expect(inviteNamesEvent("ev1@google.com", "ev1")).toBe(true);
    expect(inviteNamesEvent("abc-123", "abc-123")).toBe(true);
    expect(inviteNamesEvent("ev1@google.com", "ev2")).toBe(false);
  });
});
