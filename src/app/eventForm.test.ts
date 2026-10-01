import { describe, expect, it } from "vitest";
import type { GoogleCalendarEvent } from "../api/tauri";
import { editFormFor, eventAttendees, eventFromThread, eventTimesFromForm, smartEventDefaults } from "./eventForm";

const form = (over: Partial<Parameters<typeof eventTimesFromForm>[0]> = {}) => ({
  startDate: "2026-03-11", startTime: "10:00",
  endDate: "2026-03-11", endTime: "10:30",
  allDay: false,
  ...over,
});

describe("eventTimesFromForm", () => {
  it("reads timed events in local time", () => {
    expect(eventTimesFromForm(form())).toEqual({
      start: new Date(2026, 2, 11, 10, 0).getTime(),
      end: new Date(2026, 2, 11, 10, 30).getTime(),
    });
  });

  it("anchors all-day dates at UTC noon so the backend's date is the chosen day", () => {
    expect(eventTimesFromForm(form({ allDay: true, endDate: "2026-03-13" }))).toEqual({
      start: Date.UTC(2026, 2, 11, 12),
      end: Date.UTC(2026, 2, 13, 12),
    });
  });

  it("allows a single-day all-day event", () => {
    expect(eventTimesFromForm(form({ allDay: true }))).not.toHaveProperty("error");
  });

  it("rejects a timed event that ends before it starts", () => {
    expect(eventTimesFromForm(form({ endTime: "09:00" }))).toEqual({ error: "End must be after start" });
  });

  it("rejects an all-day event whose last day is before its first", () => {
    expect(eventTimesFromForm(form({ allDay: true, endDate: "2026-03-10" }))).toEqual({ error: "End must be after start" });
  });

  it("rejects missing dates or times instead of sending NaN", () => {
    expect(eventTimesFromForm(form({ startDate: "" }))).toEqual({ error: "Enter a valid start and end" });
    expect(eventTimesFromForm(form({ endTime: "" }))).toEqual({ error: "Enter a valid start and end" });
    expect(eventTimesFromForm(form({ allDay: true, endDate: "" }))).toEqual({ error: "Enter a valid start and end" });
  });
});

describe("smartEventDefaults", () => {
  it("rounds up to the next half hour and lasts 30 minutes", () => {
    expect(smartEventDefaults(new Date(2026, 2, 11, 9, 10))).toEqual({ date: "2026-03-11", startTime: "09:30", endDate: "2026-03-11", endTime: "10:00" });
    expect(smartEventDefaults(new Date(2026, 2, 11, 9, 45))).toEqual({ date: "2026-03-11", startTime: "10:00", endDate: "2026-03-11", endTime: "10:30" });
  });

  it("moves to the next day when rounding passes midnight", () => {
    expect(smartEventDefaults(new Date(2026, 2, 11, 23, 40))).toEqual({ date: "2026-03-12", startTime: "00:00", endDate: "2026-03-12", endTime: "00:30" });
  });

  it("ends the next day when an event starting at half past eleven runs past midnight", () => {
    expect(smartEventDefaults(new Date(2026, 2, 11, 23, 10))).toEqual({ date: "2026-03-11", startTime: "23:30", endDate: "2026-03-12", endTime: "00:00" });
  });
});

describe("eventFromThread", () => {
  it("names the event after the subject, without reply or forward prefixes", () => {
    expect(eventFromThread("Re: Fwd: Lunch on Thursday", [], "me@x.com").summary).toBe("Lunch on Thursday");
    expect(eventFromThread("RE: FW: Offsite", [], "me@x.com").summary).toBe("Offsite");
    expect(eventFromThread("Planning", [], "me@x.com").summary).toBe("Planning");
  });

  it("invites the thread's participants except the user, once each", () => {
    const { attendees } = eventFromThread("Lunch", ["Ana <ana@y.com>", "Me <ME@x.com>", "ana@y.com", "bo@z.com"], "me@x.com");
    expect(attendees).toBe("Ana <ana@y.com>, bo@z.com");
  });
});

describe("eventAttendees", () => {
  it("keeps a display name with a comma as one guest", () => {
    expect(eventAttendees('"Doe, John" <john@x.com>, ana@y.com')).toEqual(["john@x.com", "ana@y.com"]);
  });

  it("ignores empty entries", () => {
    expect(eventAttendees(" , ana@y.com, ")).toEqual(["ana@y.com"]);
    expect(eventAttendees("")).toEqual([]);
  });
});

describe("editFormFor", () => {
  const event: GoogleCalendarEvent = {
    id: "e1", calendar_id: "work", calendar_name: "Work", title: "Pricing page review", description: "Slides", location: "Sala Norte",
    start_time: new Date(2026, 9, 1, 15, 0).getTime(), end_time: new Date(2026, 9, 1, 16, 30).getTime(), all_day: false,
    status: "confirmed", organizer: "me@posta.test", html_link: null, hangout_link: null, response_status: "accepted", can_edit: true,
    attendees: [
      { email: "me@posta.test", display_name: null, response_status: "accepted", is_self: true, is_organizer: true },
      { email: "jules@posta.test", display_name: "Jules", response_status: "declined", is_self: false, is_organizer: false },
    ],
  };
  const now = new Date(2026, 9, 1, 9, 10);

  it("fills the form with the event as it is, to be edited in place", () => {
    expect(editFormFor(event, "acc", now)).toEqual({
      summary: "Pricing page review", description: "Slides", location: "Sala Norte",
      startDate: "2026-10-01", startTime: "15:00", endDate: "2026-10-01", endTime: "16:30", allDay: false,
      attendees: "me@posta.test, jules@posta.test", recurrence: null, addMeet: false,
      editing: { id: "e1", calendarId: "work", accountId: "acc" },
    });
  });

  it("gives an all-day event its last day, not Google's day after, and times it could take", () => {
    const allDay = { ...event, all_day: true, start_time: Date.UTC(2026, 9, 1), end_time: Date.UTC(2026, 9, 3) };
    expect(editFormFor(allDay, "acc", now)).toMatchObject({
      startDate: "2026-10-01", endDate: "2026-10-02", allDay: true, startTime: "09:30", endTime: "10:00",
    });
  });
});
