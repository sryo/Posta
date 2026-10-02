import { describe, expect, it } from "vitest";
import type { GoogleCalendarEvent } from "../api/tauri";
import { calendarDayMarks, dayGutters, dayNoteText, firstStartOn, gutterDay, gutterStrip, gutterText, spokenDuration, type Gutter } from "./gutters";

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

  it("names the free stretch and says its length on the 12-hour clock", () => {
    expect(gutterText(gap(at(12), at(15, 30)), at(9), "en-US")).toEqual({ line: "Free 12:00 – 3:30 PM", length: "3 and a half hours" });
    expect(gutterText(gap(at(13), at(15)), at(9), "en-US")).toEqual({ line: "Free 1:00 – 3:00 PM", length: "2 hours" });
  });

  it("gives each end its meridiem when the stretch crosses noon", () => {
    expect(gutterText(gap(at(10, 30), at(12)), at(9), "en-US")).toEqual({ line: "Free 10:30 AM – 12:00 PM", length: "an hour and a half" });
  });

  it("writes the 24-hour clock where the locale uses one", () => {
    expect(gutterText(gap(at(9), at(12, 15)), at(8), "en-GB")).toEqual({ line: "Free 09:00 – 12:15", length: "3 hours and 15 minutes" });
  });

  it("counts down to the end while now is inside", () => {
    expect(gutterText(gap(at(12), at(15, 30)), at(13, 40), "en-US")).toEqual({ line: "Free until 3:30 PM", length: "an hour and 50 minutes left" });
    expect(gutterText(gap(at(12), at(15, 30)), at(14, 45), "en-US")).toEqual({ line: "Free until 3:30 PM", length: "45 minutes left" });
    expect(gutterText(gap(at(12), at(15, 30)), at(15, 29) + 30_000, "en-US").length).toBe("a minute left");
    expect(gutterText(gap(at(12), at(15, 30)), at(15, 0), "en-GB").line).toBe("Free until 15:30");
  });

  it("calls a free end of the day by when it starts", () => {
    expect(gutterText(gap(at(12), at(18), true), at(9), "en-US")).toEqual({ line: "Afternoon's free.", length: null });
    expect(gutterText(gap(at(14, 30), at(18), true), at(15), "en-US")).toEqual({ line: "Afternoon's free.", length: null });
    expect(gutterText(gap(at(11, 59), at(18), true), at(9), "en-US")).toEqual({ line: "Rest of the day's free.", length: null });
  });
});

describe("spokenDuration", () => {
  it("says a length the way you'd say it out loud, never 1h 20m", () => {
    expect(spokenDuration(30)).toBe("half an hour");
    expect(spokenDuration(60)).toBe("an hour");
    expect(spokenDuration(80)).toBe("an hour and 20 minutes");
    expect(spokenDuration(90)).toBe("an hour and a half");
    expect(spokenDuration(120)).toBe("2 hours");
    expect(spokenDuration(150)).toBe("2 and a half hours");
    expect(spokenDuration(195)).toBe("3 hours and 15 minutes");
    expect(spokenDuration(45)).toBe("45 minutes");
  });

  it("rounds to five minutes, but counts the last few one by one", () => {
    expect(spokenDuration(83)).toBe("an hour and 25 minutes");
    expect(spokenDuration(87)).toBe("an hour and 25 minutes");
    expect(spokenDuration(88)).toBe("an hour and a half");
    expect(spokenDuration(118)).toBe("2 hours");
    expect(spokenDuration(4)).toBe("4 minutes");
    expect(spokenDuration(1)).toBe("a minute");
  });
});

describe("calendarDayMarks", () => {
  const TOMORROW_8_30 = at(8, 30, 2);
  const marks = (events: GoogleCalendarEvent[], now: number, tomorrowStart: number | null = TOMORROW_8_30, notices = true) =>
    calendarDayMarks(events, DAY, now, { tomorrowStart, notices });
  const notes = (events: GoogleCalendarEvent[], now: number, tomorrowStart?: number | null) =>
    marks(events, now, tomorrowStart).notes.map(n => [n.beforeIndex, dayNoteText(n, "en-US")]);

  it("keeps the day's gutters", () => {
    expect(marks(THURSDAY, at(9)).gutters).toEqual(dayGutters(THURSDAY, DAY, at(9)));
  });

  it("names the first one of the morning above it while it is an hour or more away", () => {
    expect(notes(THURSDAY, at(7, 45))).toEqual([[0, "First one at 9:30 AM"]]);
    expect(notes(THURSDAY, at(8, 30))).toEqual([[0, "First one at 9:30 AM"]]);
    expect(notes(THURSDAY, at(8, 31))).toEqual([]);
  });

  it("puts the first-one note above the first timed row, after the all-day ones", () => {
    const holiday = ev("holiday", Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 2), { all_day: true });
    expect(notes([holiday, ...THURSDAY], at(7))).toEqual([[1, "First one at 9:30 AM"]]);
  });

  it("says nothing of the morning while an event from the night before still runs", () => {
    const overnight = ev("flight", at(22, 0, 0), at(7, 30, 1));
    expect(notes([overnight, ...THURSDAY], at(7))).toEqual([]);
  });

  it("says the last one is on while now is inside it", () => {
    const evening = [...THURSDAY.slice(0, 2), ev("late", at(16), at(17, 30))];
    expect(notes(evening, at(16, 10))).toEqual([[3, "Last one today"]]);
    expect(notes(evening, at(15, 59))).toEqual([]);
  });

  it("leaves the last one to the gutter when the rest of the day is free after it", () => {
    expect(notes(THURSDAY.slice(0, 2), at(11, 15))).toEqual([]);
    expect(marks(THURSDAY.slice(0, 2), at(11, 15)).gutters.map(g => g.ending)).toEqual([true]);
  });

  it("says nothing else is on once the last is over, when no free gutter says so", () => {
    const day = [ev("a", at(9), at(12)), ev("b", at(12), at(16, 45))];
    expect(notes(day, at(16, 50))).toEqual([[2, "Nothing else today"]]);
    expect(notes(THURSDAY.slice(0, 2), at(13))).toEqual([]);
  });

  it("closes the day from 5 PM and says when tomorrow starts, in place of the free afternoon", () => {
    expect(notes(THURSDAY, at(17, 30))).toEqual([[4, "That's it for today. Tomorrow starts at 8:30 AM."]]);
    expect(notes(THURSDAY.slice(0, 2), at(17))).toEqual([[2, "That's it for today. Tomorrow starts at 8:30 AM."]]);
    expect(marks(THURSDAY.slice(0, 2), at(17)).gutters).toEqual([]);
    expect(marks(THURSDAY.slice(0, 2), at(16, 59)).gutters.map(g => g.ending)).toEqual([true]);
  });

  it("closes the day without tomorrow when nothing is known of it", () => {
    expect(notes(THURSDAY, at(19), null)).toEqual([[4, "That's it for today."]]);
  });

  it("waits for an evening event before closing the day", () => {
    const evening = [...THURSDAY, ev("dinner", at(19), at(21))];
    expect(notes(evening, at(18))).toEqual([]);
    expect(notes(evening, at(21, 5))).toEqual([[5, "That's it for today. Tomorrow starts at 8:30 AM."]]);
  });

  it("notes nothing on a day with nothing timed, or on a day other than today", () => {
    expect(notes([], at(18))).toEqual([]);
    expect(calendarDayMarks(THURSDAY, DAY, at(7, 0, 0), { tomorrowStart: null, notices: true }).notes).toEqual([]);
    expect(calendarDayMarks(THURSDAY, DAY, at(19, 0, 0), { tomorrowStart: null, notices: true }).notes).toEqual([]);
  });

  it("counts declined and cancelled events as not on", () => {
    const day = [...THURSDAY.slice(0, 2), ev("skipped", at(16), at(17), { response_status: "declined" })];
    expect(notes(day, at(17, 10))).toEqual([[3, "That's it for today. Tomorrow starts at 8:30 AM."]]);
  });

  it("notes nothing, and keeps the free afternoon, while noticing is off", () => {
    const off = marks(THURSDAY.slice(0, 2), at(17), TOMORROW_8_30, false);
    expect(off.notes).toEqual([]);
    expect(off.gutters.map(g => g.ending)).toEqual([true]);
    expect(marks(THURSDAY, at(7), null, false).notes).toEqual([]);
  });

  it("writes the 24-hour clock where the locale uses one", () => {
    const [note] = marks(THURSDAY, at(7)).notes;
    expect(dayNoteText(note, "en-GB")).toBe("First one at 09:30");
  });
});

describe("firstStartOn", () => {
  it("is when the day's first timed event that is on starts", () => {
    const friday = [
      ev("holiday", Date.UTC(2026, 9, 2), Date.UTC(2026, 9, 3), { all_day: true }),
      ev("skip", at(7, 0, 2), at(8, 0, 2), { response_status: "declined" }),
      ev("later", at(10, 0, 2), at(11, 0, 2)),
      ev("first", at(8, 30, 2), at(9, 0, 2)),
      ev("today", at(9), at(10)),
    ];
    expect(firstStartOn(friday, new Date(2026, 9, 2))).toBe(at(8, 30, 2));
  });

  it("is null for a day with nothing timed on it", () => {
    expect(firstStartOn([ev("today", at(9), at(10))], new Date(2026, 9, 2))).toBeNull();
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

describe("gutterStrip", () => {
  const lunch: Gutter = { beforeIndex: 2, start: at(12), end: at(15, 30), ending: false, nowAt: null };
  const pct = (h: number, m = 0) => ((h - 8) * 60 + m) / 600 * 100;

  it("lays the free stretch on 8 AM to 6 PM of its day, with the day's other events as busy blocks", () => {
    const strip = gutterStrip(lunch, THURSDAY, at(9, 15));
    expect(strip.slotBox.left).toBeCloseTo(pct(12));
    expect(strip.slotBox.width).toBeCloseTo(pct(15, 30) - pct(12));
    expect(strip.busy.map(b => [Math.round(b.left * 10) / 10, b.title])).toEqual([[Math.round(pct(9, 30) * 10) / 10, "standup"], [Math.round(pct(11) * 10) / 10, "crit"], [Math.round(pct(15, 30) * 10) / 10, "sam"], [Math.round(pct(16, 30) * 10) / 10, "roadmap"]]);
    expect(strip.noonAt).toBeCloseTo(pct(12));
    expect(strip.ticks).toHaveLength(9);
  });

  it("shades the day gone and draws now, while now is in it", () => {
    const strip = gutterStrip(lunch, THURSDAY, at(13));
    expect(strip.past).toBeCloseTo(pct(13));
    expect(strip.nowAt).toBeCloseTo(pct(13));
    const early = gutterStrip(lunch, THURSDAY, at(7));
    expect(early.past).toBeNull();
    expect(early.nowAt).toBeNull();
    expect(gutterStrip(lunch, THURSDAY, at(19)).nowAt).toBeNull();
  });

  it("leaves out what takes no time: all-day, declined and cancelled events", () => {
    const strip = gutterStrip(lunch, [ev("off", at(0), at(24), { all_day: true }), ev("no", at(9), at(10), { response_status: "declined" }), ev("gone", at(10), at(11), { status: "cancelled" })], at(9));
    expect(strip.busy).toEqual([]);
  });
});
