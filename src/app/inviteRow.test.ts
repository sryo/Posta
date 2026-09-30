import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../api/tauri";
import { formatDuration, inviteDuration, inviteTitle, inviteEnd, invitePlace, inviteState, inviteSummary, inviteWhen } from "./inviteRow";

const now = new Date(2026, 8, 29, 10, 0);
const at = (month: number, day: number, hour = 0, minute = 0) => new Date(2026, month, day, hour, minute).getTime();
// All-day events carry UTC midnight of their dates
const utcDay = (month: number, day: number, year = 2026) => Date.UTC(year, month, day);

const invite = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  uid: "ev-1@google.com",
  title: "Design review",
  start_time: at(8, 30, 15),
  end_time: at(8, 30, 16),
  all_day: false,
  location: null,
  description: null,
  organizer: "jules@x.test",
  attendees: [],
  method: "REQUEST",
  status: null,
  response_status: null,
  conference_url: null,
  ...over,
});

describe("inviteWhen", () => {
  it("names today and tomorrow, then the time", () => {
    expect(inviteWhen(invite({ start_time: at(8, 29, 15) }), now, "en-US")).toMatch(/^Today 3:00\sPM$/);
    expect(inviteWhen(invite({ start_time: at(8, 30, 15) }), now, "en-US")).toMatch(/^Tomorrow 3:00\sPM$/);
    expect(inviteWhen(invite({ start_time: at(8, 30, 15) }), now, "es-ES")).toBe("Mañana 15:00");
  });

  it("gives other days their weekday and date, as the locale writes them", () => {
    expect(inviteWhen(invite({ start_time: at(9, 2, 13) }), now, "en-US")).toMatch(/^Fri, Oct 2, 1:00\sPM$/);
    expect(inviteWhen(invite({ start_time: at(9, 2, 13) }), now, "en-GB")).toBe("Fri 2 Oct, 13:00");
    expect(inviteWhen(invite({ start_time: at(9, 2, 13) }), now, "es-ES")).toBe("Vie, 2 oct, 13:00");
  });

  it("adds the year when the event is not this year", () => {
    const start = new Date(2027, 0, 8, 9).getTime();
    expect(inviteWhen(invite({ start_time: start }), now, "en-US")).toMatch(/^Fri, Jan 8, 2027, 9:00\sAM$/);
  });

  it("gives an all-day event its day only, read from its UTC date", () => {
    expect(inviteWhen(invite({ all_day: true, start_time: utcDay(8, 30), end_time: utcDay(9, 1) }), now, "en-US")).toBe("Tomorrow");
    expect(inviteWhen(invite({ all_day: true, start_time: utcDay(9, 2), end_time: utcDay(9, 3) }), now, "en-GB")).toBe("Fri 2 Oct");
  });
});

describe("inviteTitle", () => {
  it("leaves only the event's title from Google's invite subjects", () => {
    expect(inviteTitle("Invitation: Catch Up @ Tue Oct 1, 2026 10am - 11am (GMT-3) (teo@x.com)")).toBe("Catch Up");
    expect(inviteTitle("Updated invitation with note: Design sync @ Mon Oct 19 12:20pm (GMT-3) (a@b.c)")).toBe("Design sync");
    expect(inviteTitle("Accepted: Standup @ Wed Oct 2 9am (GMT-3) (ana@y.com)")).toBe("Standup");
    expect(inviteTitle("Invitación: Turno médico @ lun 19 oct 2026 12:20 - 12:35 (GMT-3) (teo@x.com)")).toBe("Turno médico");
  });

  it("keeps a subject that is not Google's, and an @ that is part of the title", () => {
    expect(inviteTitle("Sanatorio Allende - turno confirmado")).toBe("Sanatorio Allende - turno confirmado");
    expect(inviteTitle("Coffee @ the office")).toBe("Coffee @ the office");
  });
});

describe("formatDuration", () => {
  it("writes minutes and hours short", () => {
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(60)).toBe("1 hr");
    expect(formatDuration(90)).toBe("1 hr 30 min");
    expect(formatDuration(120)).toBe("2 hr");
  });

  it("counts days for events longer than a day", () => {
    expect(formatDuration(24 * 60)).toBe("1 day");
    expect(formatDuration(26 * 60)).toBe("1 day 2 hr");
  });
});

describe("inviteDuration", () => {
  it("measures a timed event from start to end", () => {
    expect(inviteDuration(invite({ start_time: at(8, 30, 15), end_time: at(8, 30, 15, 30) }))).toBe("30 min");
    expect(inviteDuration(invite({ start_time: at(8, 30, 15), end_time: at(8, 30, 16, 30) }))).toBe("1 hr 30 min");
  });

  it("says nothing when the invite has no end", () => {
    expect(inviteDuration(invite({ end_time: null }))).toBeNull();
  });

  it("calls a one-day all-day event all day, and counts longer ones", () => {
    expect(inviteDuration(invite({ all_day: true, start_time: utcDay(9, 2), end_time: utcDay(9, 3) }))).toBe("All day");
    expect(inviteDuration(invite({ all_day: true, start_time: utcDay(9, 2), end_time: utcDay(9, 4) }))).toBe("2 days");
    expect(inviteDuration(invite({ all_day: true, start_time: utcDay(9, 2), end_time: null }))).toBe("All day");
  });
});

describe("invitePlace", () => {
  it("shows the location, with a pin", () => {
    expect(invitePlace(invite({ location: "Studio 2" }))).toEqual({ label: "Studio 2", isCall: false });
  });

  it("names the call when the place is a call link", () => {
    expect(invitePlace(invite({ location: "https://meet.google.com/abc-defg-hij" }))).toEqual({ label: "Google Meet", isCall: true });
    expect(invitePlace(invite({ location: "https://us02web.zoom.us/j/123" }))).toEqual({ label: "Zoom", isCall: true });
    expect(invitePlace(invite({ location: "https://teams.microsoft.com/l/meetup-join/x" }))).toEqual({ label: "Microsoft Teams", isCall: true });
    expect(invitePlace(invite({ location: "https://whereby.com/room" }))).toEqual({ label: "whereby.com", isCall: true });
  });

  it("falls back to the conference link when there is no location", () => {
    expect(invitePlace(invite({ conference_url: "https://meet.google.com/abc" }))).toEqual({ label: "Google Meet", isCall: true });
  });

  it("keeps a room when the event also has a call", () => {
    expect(invitePlace(invite({ location: "Studio 2", conference_url: "https://meet.google.com/abc" })))
      .toEqual({ label: "Studio 2 / Google Meet", isCall: false });
  });

  it("is empty when there is neither", () => {
    expect(invitePlace(invite())).toBeNull();
  });
});

describe("inviteEnd", () => {
  it("ends a timed event at its end, or its start without one", () => {
    expect(inviteEnd(invite())).toBe(at(8, 30, 16));
    expect(inviteEnd(invite({ end_time: null }))).toBe(at(8, 30, 15));
  });

  it("ends an all-day event at local midnight after its last day", () => {
    expect(inviteEnd(invite({ all_day: true, start_time: utcDay(9, 2), end_time: utcDay(9, 3) }))).toBe(at(9, 3));
    expect(inviteEnd(invite({ all_day: true, start_time: utcDay(9, 2), end_time: null }))).toBe(at(9, 3));
  });
});

describe("inviteState", () => {
  const t = now.getTime();
  it("asks when the user has not answered an upcoming invite", () => {
    expect(inviteState(invite(), undefined, t)).toBe("unanswered");
    expect(inviteState(invite(), "needsAction", t)).toBe("unanswered");
  });

  it("carries the user's answer", () => {
    expect(inviteState(invite(), "accepted", t)).toBe("accepted");
    expect(inviteState(invite(), "tentative", t)).toBe("tentative");
    expect(inviteState(invite(), "declined", t)).toBe("declined");
  });

  it("stops asking once the event is over", () => {
    expect(inviteState(invite({ start_time: at(8, 28, 9), end_time: at(8, 28, 10) }), undefined, t)).toBe("past");
    expect(inviteState(invite({ start_time: at(8, 28, 9), end_time: at(8, 28, 10) }), "accepted", t)).toBe("past");
  });

  it("can still be answered while the event runs", () => {
    expect(inviteState(invite({ start_time: at(8, 29, 9, 30), end_time: at(8, 29, 10, 30) }), undefined, t)).toBe("unanswered");
  });

  it("marks cancellations and mail that asks nothing", () => {
    expect(inviteState(invite({ method: "CANCEL" }), undefined, t)).toBe("cancelled");
    expect(inviteState(invite({ status: "CANCELLED" }), undefined, t)).toBe("cancelled");
    expect(inviteState(invite({ method: "REPLY" }), undefined, t)).toBe("info");
    expect(inviteState(invite({ uid: null }), undefined, t)).toBe("info");
  });
});

describe("inviteSummary", () => {
  const q4 = invite({ start_time: at(9, 1, 10, 30), end_time: at(9, 1, 11, 30) });

  it("reads the day, the times, how far off it is and the answer", () => {
    expect(inviteSummary(q4, now, { rsvp: undefined, locale: "en-GB" }))
      .toBe("Thursday 1 October, 10:30 to 11:30, in 2 days. You have not answered.");
  });

  it("names the events it overlaps", () => {
    const clashes = [{ title: "Dentist", start: at(9, 1, 11) }];
    expect(inviteSummary(q4, now, { rsvp: undefined, clashes, locale: "en-GB" }))
      .toBe("Thursday 1 October, 10:30 to 11:30, in 2 days. Overlaps Dentist, 11:00. You have not answered.");
  });

  it("says what the user answered", () => {
    expect(inviteSummary(q4, now, { rsvp: "accepted", locale: "en-GB" })).toMatch(/You're going\.$/);
    expect(inviteSummary(q4, now, { rsvp: "tentative", locale: "en-GB" })).toMatch(/You said maybe\.$/);
    expect(inviteSummary(q4, now, { rsvp: "declined", locale: "en-GB" })).toMatch(/You're not going\.$/);
  });

  it("reads an all-day event as all day, and a cancelled or past one without asking", () => {
    const allDay = invite({ all_day: true, start_time: utcDay(9, 2), end_time: utcDay(9, 3) });
    expect(inviteSummary(allDay, now, { rsvp: undefined, locale: "en-GB" })).toBe("Friday 2 October, all day, in 3 days. You have not answered.");
    expect(inviteSummary(invite({ method: "CANCEL" }), now, { rsvp: undefined, locale: "en-GB" })).toBe("Wednesday 30 September, 15:00 to 16:00, tomorrow. Cancelled.");
    const past = invite({ start_time: at(8, 28, 9), end_time: at(8, 28, 10) });
    expect(inviteSummary(past, now, { rsvp: undefined, locale: "en-GB" })).toBe("Monday 28 September, 09:00 to 10:00, yesterday.");
  });
});
