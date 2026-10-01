import { describe, expect, it } from "vitest";
import type { GoogleCalendarEvent } from "../api/tauri";
import { aloneAt, aloneText, cancelPrompt, guestsOf, isRoom } from "./attendance";

const ME = "me@posta.test";
const NOW = new Date(2026, 9, 1, 9).getTime();
const LATER = new Date(2026, 9, 1, 15).getTime();

type Attendee = GoogleCalendarEvent["attendees"][number];
const person = (email: string, response_status: string | null, extra: Partial<Attendee> = {}): Attendee =>
  ({ email, display_name: null, response_status, is_self: false, is_organizer: false, ...extra });
const me = (response_status: string, extra: Partial<Attendee> = {}) => person(ME, response_status, { is_self: true, ...extra });
const ROOM = person("c_1888abc@resource.calendar.google.com", "accepted", { display_name: "Sala Norte" });

const ev = (attendees: Attendee[], extra: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent => ({
  id: "e1", calendar_id: "primary", calendar_name: "Work", title: "Pricing page review", description: null, location: null,
  start_time: LATER, end_time: LATER + 3_600_000, all_day: false, status: "confirmed", organizer: "lucia@posta.test",
  attendees, html_link: null, hangout_link: null, response_status: "accepted", can_edit: false, ...extra,
});

// The user's own meeting: they organize it
const mine = (attendees: Attendee[], extra: Partial<GoogleCalendarEvent> = {}) =>
  ev([me("accepted", { is_organizer: true }), ...attendees], { organizer: ME, can_edit: true, ...extra });

describe("aloneAt", () => {
  it("notices when every other guest of an event the user is going to has declined", () => {
    const event = ev([me("accepted"), person("lucia@posta.test", "declined", { is_organizer: true }), person("jules@posta.test", "declined")]);
    expect(aloneAt(event, ME, NOW)).toEqual({ role: "guest", guests: 2 });
  });

  it("counts the guests the organizer invited", () => {
    const event = mine([person("jules@posta.test", "declined"), person("marta@posta.test", "declined"), person("priya@posta.test", "declined")]);
    expect(aloneAt(event, ME, NOW)).toEqual({ role: "organizer", guests: 3 });
  });

  it("stays silent while anyone else is still to answer, might come, or is coming", () => {
    for (const answer of ["needsAction", "tentative", "accepted", null]) {
      const event = mine([person("jules@posta.test", "declined"), person("priya@posta.test", answer)]);
      expect(aloneAt(event, ME, NOW)).toBeNull();
    }
  });

  it("doesn't count a room as a guest: a room never attends", () => {
    expect(isRoom(ROOM)).toBe(true);
    expect(isRoom(person("jules@posta.test", "declined"))).toBe(false);
    expect(aloneAt(mine([ROOM]), ME, NOW)).toBeNull();
    expect(aloneAt(mine([ROOM, person("jules@posta.test", "declined")]), ME, NOW)).toEqual({ role: "organizer", guests: 1 });
  });

  it("never fires for an event with no other guests, or whose guest list is hidden", () => {
    expect(aloneAt(mine([]), ME, NOW)).toBeNull();
    expect(aloneAt(ev([]), ME, NOW)).toBeNull();
  });

  it("finds the user by address when Google doesn't mark them as self", () => {
    const event = ev([person(ME.toUpperCase(), "accepted"), person("lucia@posta.test", "declined", { is_organizer: true })]);
    expect(aloneAt(event, ME, NOW)).toEqual({ role: "guest", guests: 1 });
  });

  it("stays silent once the user has declined too, or the event is cancelled, all day, or under way", () => {
    const declinedAll = [person("jules@posta.test", "declined"), person("lucia@posta.test", "declined", { is_organizer: true })];
    expect(aloneAt(ev([me("declined"), ...declinedAll], { response_status: "declined" }), ME, NOW)).toBeNull();
    expect(aloneAt(ev([me("accepted"), ...declinedAll], { status: "cancelled" }), ME, NOW)).toBeNull();
    expect(aloneAt(ev([me("accepted"), ...declinedAll], { all_day: true }), ME, NOW)).toBeNull();
    expect(aloneAt(ev([me("accepted"), ...declinedAll]), ME, LATER)).toBeNull();
  });
});

describe("aloneText", () => {
  it("says it plainly to a guest, and counts for the organizer", () => {
    expect(aloneText({ role: "guest", guests: 3 })).toBe("Everyone else declined");
    expect(aloneText({ role: "organizer", guests: 3 })).toBe("All 3 guests declined");
    expect(aloneText({ role: "organizer", guests: 2 })).toBe("Both guests declined");
    expect(aloneText({ role: "organizer", guests: 1 })).toBe("Your guest declined");
  });
});

describe("guestsOf", () => {
  it("lists the people besides the user, leaving out rooms", () => {
    const event = mine([ROOM, person("jules@posta.test", "declined")]);
    expect(guestsOf(event, ME).map(a => a.email)).toEqual(["jules@posta.test"]);
  });
});

describe("cancelPrompt", () => {
  it("asks before cancelling, saying the guests hear about it", () => {
    expect(cancelPrompt(3)).toEqual({
      title: "Cancel and notify 3 guests?",
      message: "Each guest gets an email saying the event was cancelled.",
      confirmLabel: "Cancel event",
      cancelLabel: "Keep it",
      tone: "danger",
    });
    expect(cancelPrompt(1).title).toBe("Cancel and notify 1 guest?");
  });
});
