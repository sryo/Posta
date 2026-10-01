import { describe, expect, it } from "vitest";
import type { GoogleCalendarEvent } from "../api/tauri";
import { dayGutters, gutterDay, gutterText, type Gutter } from "./gutters";

const DAY = new Date(2026, 9, 1);
const at = (h: number, m = 0, day = 1) => new Date(2026, 9, day, h, m).getTime();

const ev = (id: string, start: number, end: number | null, extra: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent => ({
  id, calendar_id: "primary", calendar_name: "Main", title: id, description: null, location: null,
  start_time: start, end_time: end, all_day: false, status: "confirmed", organizer: null, attendees: [],
  html_link: null, hangout_link: null, response_status: "accepted", can_edit: true, ...extra,
});

// The proposal's Thursday: two morning meetings, a long lunch, two late ones
const THURSDAY = [
  ev("standup", at(9, 30), at(10, 30)),
  ev("crit", at(11), at(12)),
  ev("sam", at(15, 30), at(16, 30)),
  ev("roadmap", at(16, 30), at(17, 30)),
];

const spans = (gutters: Gutter[]) => gutters.map(g => [new Date(g.start).toTimeString().slice(0, 5), new Date(g.end).toTimeString().slice(0, 5), g.ending]);

describe("dayGutters", () => {
  it("marks a free stretch of 90 minutes or more between events, above the event that ends it", () => {
    const gutters = dayGutters(THURSDAY, DAY, at(9, 15));
    expect(gutters).toEqual([{ beforeIndex: 2, start: at(12), end: at(15, 30), ending: false, nowAt: null }]);
  });

  it("leaves shorter gaps out, so a busy day looks busy", () => {
    expect(dayGutters([ev("a", at(9), at(12)), ev("b", at(13, 29), at(18))], DAY, at(8))).toEqual([]);
    expect(spans(dayGutters([ev("a", at(9), at(12)), ev("b", at(13, 30), at(18))], DAY, at(8)))).toEqual([["12:00", "13:30", false]]);
  });

  it("runs a gap after the last event to 6 PM as the end of the day", () => {
    const gutters = dayGutters(THURSDAY.slice(0, 2), DAY, at(10, 30));
    expect(gutters).toEqual([{ beforeIndex: 2, start: at(12), end: at(18), ending: true, nowAt: null }]);
  });

  it("ends the working day at 6 PM, so an evening event leaves the afternoon free", () => {
    const evening = [ev("a", at(9), at(12)), ev("dinner", at(19), at(21))];
    expect(dayGutters(evening, DAY, at(8))).toEqual([{ beforeIndex: 1, start: at(12), end: at(18), ending: true, nowAt: null }]);
    expect(dayGutters([ev("a", at(9), at(16, 45)), ev("dinner", at(19), at(21))], DAY, at(8))).toEqual([]);
    expect(dayGutters([ev("drinks", at(18, 30), at(20))], DAY, at(8))).toEqual([]);
  });

  it("starts the day at its first event, with no gutter above it", () => {
    expect(spans(dayGutters([ev("late", at(14), at(15))], DAY, at(8)))).toEqual([["15:00", "18:00", true]]);
  });

  it("frees no time while overlapping events still cover it", () => {
    const overlapping = [ev("a", at(9), at(11)), ev("b", at(10), at(12, 30)), ev("c", at(11, 30), at(12)), ev("d", at(13, 30), at(18))];
    expect(dayGutters(overlapping, DAY, at(8))).toEqual([]);
  });

  it("counts a long event that swallows a shorter one by its own end", () => {
    const nested = [ev("offsite", at(9), at(14)), ev("call", at(10), at(11)), ev("review", at(15), at(18))];
    expect(dayGutters(nested, DAY, at(8))).toEqual([]);
  });

  it("doesn't count all-day, declined or cancelled events as busy", () => {
    const allDay = ev("holiday", Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 2), { all_day: true });
    const declined = ev("declined", at(12, 30), at(13, 30), { response_status: "declined" });
    const cancelled = ev("cancelled", at(13), at(14), { status: "cancelled" });
    const events = [allDay, ev("a", at(9), at(12)), declined, cancelled, ev("b", at(15), at(18))];
    expect(dayGutters(events, DAY, at(8))).toEqual([{ beforeIndex: 2, start: at(12), end: at(15), ending: false, nowAt: null }]);
  });

  it("counts tentative and unanswered events as busy", () => {
    const events = [ev("a", at(9), at(12)), ev("maybe", at(13), at(14), { response_status: "tentative" }), ev("ask", at(14), at(15), { response_status: "needsAction" })];
    expect(spans(dayGutters(events, DAY, at(8)))).toEqual([["15:00", "18:00", true]]);
  });

  it("gives an event with no end an hour", () => {
    expect(spans(dayGutters([ev("a", at(9), null), ev("b", at(12), at(13))], DAY, at(8)))).toEqual([["10:00", "12:00", false], ["13:00", "18:00", true]]);
  });

  it("counts an event running in from the night before until it ends", () => {
    const overnight = ev("flight", at(22, 0, 0), at(10, 0, 1));
    expect(spans(dayGutters([overnight, ev("b", at(13), at(18))], DAY, at(8)))).toEqual([["10:00", "13:00", false]]);
  });

  it("marks no gutters on a day with nothing timed in it", () => {
    expect(dayGutters([], DAY, at(8))).toEqual([]);
    expect(dayGutters([ev("holiday", Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 2), { all_day: true })], DAY, at(8))).toEqual([]);
  });

  it("drops a gap that is already over", () => {
    expect(dayGutters(THURSDAY, DAY, at(15, 30))).toEqual([]);
    expect(dayGutters(THURSDAY.slice(0, 2), DAY, at(18))).toEqual([]);
  });

  it("places the now-mark the way through a gap now is inside", () => {
    const [gutter] = dayGutters(THURSDAY, DAY, at(13, 45));
    expect(gutter.nowAt).toBeCloseTo(0.5);
    expect(dayGutters(THURSDAY, DAY, at(12))[0].nowAt).toBe(0);
  });

  it("marks no now in the free end of the day", () => {
    expect(dayGutters(THURSDAY.slice(0, 2), DAY, at(14))[0].nowAt).toBeNull();
  });
});

describe("gutterText", () => {
  const gap = (start: number, end: number, ending = false): Gutter => ({ beforeIndex: 0, start, end, ending, nowAt: null });

  it("names the free stretch and its length on the 12-hour clock", () => {
    expect(gutterText(gap(at(12), at(15, 30)), at(9), "en-US")).toEqual({ line: "Free 12:00 – 3:30 PM", length: "3 h 30 m" });
    expect(gutterText(gap(at(13), at(15)), at(9), "en-US")).toEqual({ line: "Free 1:00 – 3:00 PM", length: "2 h" });
  });

  it("gives each end its meridiem when the stretch crosses noon", () => {
    expect(gutterText(gap(at(10, 30), at(12)), at(9), "en-US")).toEqual({ line: "Free 10:30 AM – 12:00 PM", length: "1 h 30 m" });
  });

  it("writes the 24-hour clock where the locale uses one", () => {
    expect(gutterText(gap(at(9), at(12, 15)), at(8), "en-GB")).toEqual({ line: "Free 09:00 – 12:15", length: "3 h 15 m" });
  });

  it("counts down to the end while now is inside", () => {
    expect(gutterText(gap(at(12), at(15, 30)), at(13, 40), "en-US")).toEqual({ line: "Free until 3:30 PM", length: "1 h 50 m left" });
    expect(gutterText(gap(at(12), at(15, 30)), at(14, 45), "en-US")).toEqual({ line: "Free until 3:30 PM", length: "45 m left" });
    expect(gutterText(gap(at(12), at(15, 30)), at(15, 29) + 30_000, "en-US").length).toBe("1 m left");
    expect(gutterText(gap(at(12), at(15, 30)), at(15, 0), "en-GB").line).toBe("Free until 15:30");
  });

  it("calls a free end of the day by when it starts", () => {
    expect(gutterText(gap(at(12), at(18), true), at(9), "en-US")).toEqual({ line: "Afternoon's free.", length: null });
    expect(gutterText(gap(at(14, 30), at(18), true), at(15), "en-US")).toEqual({ line: "Afternoon's free.", length: null });
    expect(gutterText(gap(at(11, 59), at(18), true), at(9), "en-US")).toEqual({ line: "Rest of the day's free.", length: null });
  });
});

describe("gutterDay", () => {
  const now = new Date(2026, 9, 1, 14, 20);

  it("is today's or tomorrow's midnight for a card of that day", () => {
    expect(gutterDay("calendar:today", now)).toEqual(new Date(2026, 9, 1));
    expect(gutterDay("calendar:Tomorrow is:accepted", now)).toEqual(new Date(2026, 9, 2));
    expect(gutterDay("calendar:tomorrow", new Date(2026, 11, 31, 23))).toEqual(new Date(2027, 0, 1));
  });

  it("is null for a card spanning more days", () => {
    expect(gutterDay("calendar:week", now)).toBeNull();
    expect(gutterDay("calendar:1d", now)).toBeNull();
    expect(gutterDay("from:sam", now)).toBeNull();
  });
});
