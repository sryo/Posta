import { describe, expect, it } from "vitest";
import { eventReplyRecipients } from "./eventReply";

const attendee = (email: string, flags: { self?: boolean; organizer?: boolean } = {}) => ({
  email, display_name: null, response_status: null, is_self: !!flags.self, is_organizer: !!flags.organizer,
});

describe("eventReplyRecipients", () => {
  it("replies to someone else's event's organizer", () => {
    const event = { organizer: "ana@x.com", attendees: [attendee("ana@x.com", { organizer: true }), attendee("me@x.com", { self: true }), attendee("bo@x.com")] };
    expect(eventReplyRecipients(event, "me@x.com")).toEqual({ to: "ana@x.com", cc: "" });
  });

  it("copies the other guests on reply all without repeating the organizer or the user", () => {
    const event = { organizer: "ana@x.com", attendees: [attendee("Ana@x.com", { organizer: true }), attendee("me@x.com", { self: true }), attendee("bo@x.com"), attendee("bo@x.com")] };
    expect(eventReplyRecipients(event, "me@x.com", true)).toEqual({ to: "ana@x.com", cc: "bo@x.com" });
  });

  it("replies to the guests of the user's own event", () => {
    const event = { organizer: "ME@x.com", attendees: [attendee("me@x.com", { self: true, organizer: true }), attendee("bo@x.com"), attendee("cy@x.com")] };
    expect(eventReplyRecipients(event, "me@x.com")).toEqual({ to: "bo@x.com, cy@x.com", cc: "" });
    expect(eventReplyRecipients(event, "me@x.com", true)).toEqual({ to: "bo@x.com, cy@x.com", cc: "" });
  });

  it("treats an event organized from an alias as the user's own", () => {
    const event = { organizer: "alias@x.com", attendees: [attendee("alias@x.com", { self: true, organizer: true }), attendee("bo@x.com")] };
    expect(eventReplyRecipients(event, "me@x.com")).toEqual({ to: "bo@x.com", cc: "" });
  });

  it("has no one to reply to on a solo event of the user's", () => {
    expect(eventReplyRecipients({ organizer: "me@x.com", attendees: [] }, "me@x.com")).toEqual({ to: "", cc: "" });
  });
});
