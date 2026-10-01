import { describe, expect, it } from "vitest";
import type { GoogleCalendarEvent } from "../api/tauri";
import { deletePrompt, eventActions, isWritableCalendar, meetingOver } from "./eventActions";

const ME = "me@posta.test";

const guest = (email: string, extra: Partial<GoogleCalendarEvent["attendees"][number]> = {}) =>
  ({ email, display_name: null, response_status: "needsAction", is_self: false, is_organizer: false, ...extra });

const base: GoogleCalendarEvent = {
  id: "e1",
  calendar_id: "primary",
  calendar_name: "Work",
  title: "Standup",
  description: null,
  location: null,
  start_time: 0,
  end_time: 3_600_000,
  all_day: false,
  status: "confirmed",
  organizer: ME,
  attendees: [],
  html_link: "https://calendar.google.com/x",
  hangout_link: null,
  response_status: null,
  can_edit: true,
};

const ev = (extra: Partial<GoogleCalendarEvent>) => ({ ...base, ...extra });

describe("eventActions", () => {
  it("lets the owner of a solo event edit, delete and move it, with no one to reply to", () => {
    const a = eventActions(ev({}), ME);
    expect(a.role).toBe("owner");
    expect(a).toMatchObject({ edit: true, delete: true, move: true, rsvp: false, reply: false, emailGuests: false });
  });

  it("treats an event without an organizer on the user's calendar as theirs", () => {
    expect(eventActions(ev({ organizer: null }), ME).role).toBe("owner");
  });

  it("lets a guest answer, reply to the organizer and join, but not change the event", () => {
    const a = eventActions(ev({
      organizer: "boss@x.test",
      can_edit: false,
      hangout_link: "https://meet.google.com/abc",
      response_status: "needsAction",
      attendees: [guest("boss@x.test", { is_organizer: true }), guest(ME, { is_self: true })],
    }), ME);
    expect(a.role).toBe("guest");
    expect(a).toMatchObject({ rsvp: true, reply: true, join: true, edit: false, delete: false, move: false, emailGuests: false });
  });

  it("keeps a guest a guest when the organizer lets guests edit", () => {
    const a = eventActions(ev({ organizer: "boss@x.test", attendees: [guest(ME, { is_self: true })] }), ME);
    expect(a.role).toBe("guest");
    expect(a.move).toBe(false);
  });

  it("lets an organizer with guests edit, delete and email them, counting the others", () => {
    const a = eventActions(ev({
      attendees: [guest(ME, { is_self: true, is_organizer: true }), guest("a@x.test"), guest("b@x.test")],
    }), ME);
    expect(a.role).toBe("organizer");
    expect(a).toMatchObject({ edit: true, delete: true, emailGuests: true, reply: false, rsvp: false, guestCount: 2 });
  });

  it("recognises the user as organizer whatever the address's case", () => {
    expect(eventActions(ev({ organizer: "Me@Posta.test", attendees: [guest("a@x.test")] }), ME).role).toBe("organizer");
  });

  it("offers Join and Google Calendar only when the event has the link", () => {
    expect(eventActions(ev({}), ME)).toMatchObject({ join: false, open: true });
    expect(eventActions(ev({ html_link: null, hangout_link: "https://meet.google.com/x" }), ME)).toMatchObject({ join: true, open: false });
  });

  it("offers no reply to a guest when the organizer is unknown", () => {
    const a = eventActions(ev({ organizer: null, can_edit: false, attendees: [guest(ME, { is_self: true })] }), ME);
    expect(a.role).toBe("guest");
    expect(a.reply).toBe(false);
  });
});

describe("deletePrompt", () => {
  it("warns the organizer that guests hear about it", () => {
    const withGuests = eventActions(ev({ attendees: [guest("a@x.test"), guest("b@x.test"), guest("c@x.test"), guest("d@x.test"), guest("e@x.test")] }), ME);
    expect(deletePrompt(withGuests)).toBe("Delete and notify 5 guests?");
    const one = eventActions(ev({ attendees: [guest("a@x.test")] }), ME);
    expect(deletePrompt(one)).toBe("Delete and notify 1 guest?");
    expect(deletePrompt(eventActions(ev({}), ME))).toBe("Delete event?");
  });
});

describe("isWritableCalendar", () => {
  it("is true for calendars the user owns or can write to", () => {
    expect(isWritableCalendar({ access_role: "owner" })).toBe(true);
    expect(isWritableCalendar({ access_role: "writer" })).toBe(true);
    expect(isWritableCalendar({ access_role: "reader" })).toBe(false);
    expect(isWritableCalendar({ access_role: "freeBusyReader" })).toBe(false);
  });
});

describe("meetingOver", () => {
  const HOUR = 3_600_000;
  it("is over once the event ends", () => {
    expect(meetingOver(ev({ start_time: 0, end_time: HOUR }), HOUR - 1)).toBe(false);
    expect(meetingOver(ev({ start_time: 0, end_time: HOUR }), HOUR)).toBe(true);
  });

  it("takes an event without an end as an hour long, or a day when all day", () => {
    expect(meetingOver(ev({ start_time: 0, end_time: null }), HOUR - 1)).toBe(false);
    expect(meetingOver(ev({ start_time: 0, end_time: null }), HOUR)).toBe(true);
    expect(meetingOver(ev({ start_time: 0, end_time: null, all_day: true }), 23 * HOUR)).toBe(false);
  });
});
