import { describe, expect, it } from "vitest";
import { guestResponseLabel, inviteNamesEvent, isRsvpAnswer, ownResponseLabel, rsvpForKey, rsvpFailureMessage, rsvpSentMessage, RSVP_ANSWERS, withOwnResponse } from "./rsvp";

describe("rsvpSentMessage", () => {
  it("confirms the answer in the user's own words", () => {
    expect(rsvpSentMessage("accepted")).toBe("You're going");
    expect(rsvpSentMessage("tentative")).toBe("You said maybe");
    expect(rsvpSentMessage("declined")).toBe("You're not going");
  });

  it("names the event answered", () => {
    expect(rsvpSentMessage("accepted", "Planning")).toBe("You're going to “Planning”");
    expect(rsvpSentMessage("tentative", "Planning")).toBe("You said maybe to “Planning”");
    expect(rsvpSentMessage("declined", "Planning")).toBe("You're not going to “Planning”");
  });
});

describe("rsvpFailureMessage", () => {
  it("names the event it couldn't answer", () => {
    expect(rsvpFailureMessage("Planning")).toBe("Couldn't send your RSVP to “Planning”");
    expect(rsvpFailureMessage("")).toBe("Couldn't send your RSVP");
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

describe("withOwnResponse", () => {
  const guest = (email: string, response_status: string | null, is_self = false) =>
    ({ email, display_name: null, response_status, is_self, is_organizer: false });

  it("answers for the user in the event and in its guest list", () => {
    const event = { response_status: "needsAction", attendees: [guest("jules@x.test", "accepted"), guest("me@x.test", "needsAction", true)] };
    const answered = withOwnResponse(event, "declined", "me@x.test");
    expect(answered.response_status).toBe("declined");
    expect(answered.attendees.map(a => a.response_status)).toEqual(["accepted", "declined"]);
    expect(event.attendees[1].response_status).toBe("needsAction");
  });

  it("finds the user by address when Google didn't flag them", () => {
    const event = { response_status: null, attendees: [guest("Me@X.test", null)] };
    expect(withOwnResponse(event, "tentative", "me@x.test").attendees[0].response_status).toBe("tentative");
  });

  it("leaves the guest list alone when the user isn't on it", () => {
    const event = { response_status: null, attendees: [guest("jules@x.test", "accepted")] };
    const answered = withOwnResponse(event, "accepted", "me@x.test");
    expect(answered.attendees).toBe(event.attendees);
  });
});
