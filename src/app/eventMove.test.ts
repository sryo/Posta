import { describe, expect, it } from "vitest";
import type { GoogleCalendarEvent } from "../api/tauri";
import { gutterMoveStart, moveInput, moveRefusal, moveToastText, moveVerdict, movedTo, sameTimeOn } from "./eventMove";

const ME = "me@posta.test";
// Thursday 1 October 2026; day 2 is the Friday, 5 the Monday after
const at = (h: number, m = 0, day = 1) => new Date(2026, 9, day, h, m).getTime();

type Attendee = GoogleCalendarEvent["attendees"][number];
const person = (email: string, extra: Partial<Attendee> = {}): Attendee =>
  ({ email, display_name: null, response_status: "accepted", is_self: false, is_organizer: false, ...extra });

const ev = (id: string, start: number, end: number | null, extra: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent => ({
  id, calendar_id: "primary", calendar_name: "Work", title: id, description: null, location: null,
  start_time: start, end_time: end, all_day: false, status: "confirmed", organizer: ME, attendees: [],
  html_link: null, hangout_link: null, response_status: "accepted", can_edit: true, ...extra,
});

const standup = ev("Standup", at(10), at(10, 30), {
  attendees: [person(ME, { is_self: true, is_organizer: true }), person("a@x.com"), person("b@x.com"), person("c@x.com"), person("d@x.com"), person("room@resource.calendar.google.com")],
});
const dentist = ev("Dentist", at(9, 30, 2), at(10, 30, 2));

describe("sameTimeOn", () => {
  it("keeps the event's clock time and length on another day", () => {
    expect(sameTimeOn(standup, new Date(2026, 9, 5))).toBe(at(10, 0, 5));
  });

  it("keeps the clock time across a change to summer time", () => {
    const sunday = new Date(2026, 2, 29);
    const friday = ev("x", new Date(2026, 2, 27, 10).getTime(), new Date(2026, 2, 27, 11).getTime());
    expect(new Date(sameTimeOn(friday, sunday)).getHours()).toBe(10);
  });
});

describe("movedTo", () => {
  it("keeps the event's length, an hour for one with no end", () => {
    expect(movedTo(standup, at(14, 0, 2))).toEqual({ start_time: at(14, 0, 2), end_time: at(14, 30, 2) });
    expect(movedTo(ev("x", at(9), null), at(14))).toEqual({ start_time: at(14), end_time: at(15) });
  });
});

describe("moveVerdict", () => {
  const held = [standup, dentist, ev("Call with Lucía", at(15, 0, 2), at(15, 30, 2))];

  it("says the time is free when nothing else is on then", () => {
    expect(moveVerdict(standup, at(10, 0, 5), held, "en-GB")).toEqual({ free: true, text: "10:00 is free", clash: null });
  });

  it("names what it would clash with, and when that starts", () => {
    expect(moveVerdict(standup, at(10, 0, 2), held, "en-GB")).toEqual({ free: false, text: "clashes with Dentist, 09:30", clash: dentist });
    expect(moveVerdict(standup, at(10, 0, 2), held, "en-US").text).toBe("clashes with Dentist, 9:30 AM");
  });

  it("lets it end as another starts, or start as another ends", () => {
    expect(moveVerdict(standup, at(9, 0, 2), held, "en-GB").free).toBe(true);
    expect(moveVerdict(standup, at(10, 30, 2), held, "en-GB").free).toBe(true);
  });

  it("doesn't count itself, all-day events, or ones declined or cancelled", () => {
    const others = [
      standup,
      ev("Holiday", Date.UTC(2026, 9, 2), Date.UTC(2026, 9, 3), { all_day: true }),
      ev("Skipped", at(10, 0, 2), at(11, 0, 2), { response_status: "declined" }),
      ev("Off", at(10, 0, 2), at(11, 0, 2), { status: "cancelled" }),
    ];
    expect(moveVerdict(standup, at(10, 0, 2), others, "en-GB").free).toBe(true);
    expect(moveVerdict(standup, at(10, 15), others, "en-GB").free).toBe(true);
  });

  it("names the earliest of several clashes", () => {
    const busy = [ev("Late", at(10, 15, 2), at(11, 0, 2)), dentist];
    expect(moveVerdict(standup, at(10, 0, 2), busy, "en-GB").text).toBe("clashes with Dentist, 09:30");
  });
});

describe("moveRefusal", () => {
  it("lets the user move an event they can change", () => {
    expect(moveRefusal(standup, ME)).toBeNull();
  });

  it("says who can move someone else's event", () => {
    const theirs = ev("Call", at(15), at(16), {
      organizer: "lucia@x.com", can_edit: false,
      attendees: [person(ME, { is_self: true }), person("lucia@x.com", { display_name: "Lucía", is_organizer: true })],
    });
    expect(moveRefusal(theirs, ME)).toBe("Only Lucía can move this");
  });

  it("keeps an event the user can't edit, even their own, in place", () => {
    expect(moveRefusal(ev("Shared", at(15), at(16), { can_edit: false, organizer: null }), ME)).toBe("You can't change this event");
  });

  it("leaves an all-day event to its own view", () => {
    expect(moveRefusal(ev("Trip", Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 3), { all_day: true }), ME)).toBe("Open an all-day event to move it");
  });
});

describe("moveToastText", () => {
  it("says where it went and how many guests get an update, rooms aside", () => {
    expect(moveToastText(standup, at(10, 0, 2), ME, null, "en-GB")).toBe("Moved Standup to Fri 10:00 · 4 guests get an update");
  });

  it("says one guest gets it, and none when it's only the user's", () => {
    const call = { ...standup, attendees: [person(ME, { is_self: true, is_organizer: true }), person("a@x.com")] };
    expect(moveToastText(call, at(10, 0, 5), ME, null, "en-GB")).toBe("Moved Standup to Mon 10:00 · 1 guest gets an update");
    expect(moveToastText(ev("Focus", at(9), at(10)), at(14), ME, null, "en-US")).toBe("Moved Focus to Thu 2:00 PM");
  });

  it("repeats what it overlaps", () => {
    expect(moveToastText(standup, at(10, 0, 2), ME, dentist, "en-GB")).toBe("Moved Standup to Fri 10:00 · 4 guests get an update · overlaps Dentist");
  });
});

describe("gutterMoveStart", () => {
  const gutter = { beforeIndex: 1, start: at(12), end: at(15, 30), ending: false, nowAt: null };

  it("starts the event where the free stretch starts", () => {
    expect(gutterMoveStart(gutter, at(9))).toBe(at(12));
  });

  it("starts it at the next quarter hour while the stretch is under way", () => {
    expect(gutterMoveStart(gutter, at(13, 5))).toBe(at(13, 15));
    expect(gutterMoveStart(gutter, at(13, 15))).toBe(at(13, 15));
  });
});

describe("moveInput", () => {
  it("writes the event's own fields back with its new times, leaving guests and repeats alone", () => {
    const event = { ...standup, description: "Notes", location: "Sala Norte" };
    expect(moveInput(event, at(10, 0, 2))).toEqual({
      summary: "Standup", description: "Notes", location: "Sala Norte",
      startTime: at(10, 0, 2), endTime: at(10, 30, 2), allDay: false, attendees: null, recurrence: null,
    });
  });
});
