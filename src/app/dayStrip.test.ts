import { describe, expect, it } from "vitest";
import type { GoogleCalendarEvent } from "../api/tauri";
import { clashesWith, dayOtherEvents, stripLayout, stripWindow } from "./dayStrip";

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const HOUR = 3_600_000;

const listed = (id: string, title: string, start: number, end: number, over: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent => ({
  id, calendar_id: "primary", calendar_name: "Me", title, description: null, location: null,
  start_time: start, end_time: end, all_day: false, status: "confirmed", organizer: null, attendees: [],
  html_link: null, hangout_link: null, response_status: "accepted", can_edit: true, ...over,
});

describe("stripWindow", () => {
  it("shows 8 a.m. to 8 p.m. of the event's day", () => {
    expect(stripWindow(at(1, 10, 30), at(1, 11, 30))).toEqual({ start: at(1, 8), end: at(1, 20) });
  });

  it("moves earlier for an early event, keeping twelve hours", () => {
    expect(stripWindow(at(1, 6, 30), at(1, 7, 30))).toEqual({ start: at(1, 6), end: at(1, 18) });
  });

  it("moves later for a late event, up to midnight", () => {
    expect(stripWindow(at(1, 20, 30), at(1, 21, 15))).toEqual({ start: at(1, 10), end: at(1, 22) });
    expect(stripWindow(at(1, 23), at(2, 0))).toEqual({ start: at(1, 12), end: at(2, 0) });
  });

  it("starts at the event when it is longer than the window", () => {
    expect(stripWindow(at(1, 7), at(1, 21))).toEqual({ start: at(1, 7), end: at(1, 19) });
  });
});

describe("clashesWith", () => {
  const slot = { start: at(1, 10, 30), end: at(1, 11, 30) };
  it("finds events that overlap the slot", () => {
    const dentist = { title: "Dentist", start: at(1, 11), end: at(1, 12) };
    const lunch = { title: "Lunch", start: at(1, 13), end: at(1, 14) };
    expect(clashesWith(slot, [dentist, lunch])).toEqual([dentist]);
  });

  it("does not count events that only touch it", () => {
    expect(clashesWith(slot, [{ title: "Standup", start: at(1, 10), end: at(1, 10, 30) }])).toEqual([]);
    expect(clashesWith(slot, [{ title: "Walk", start: at(1, 11, 30), end: at(1, 12) }])).toEqual([]);
  });
});

describe("dayOtherEvents", () => {
  const invite = { uid: "q4@google.com", start: at(1, 10, 30), end: at(1, 11, 30) };

  it("keeps the user's other timed events on the invite's day", () => {
    const events = [
      listed("a", "Dentist", at(1, 11), at(1, 12)),
      listed("b", "Yesterday", at(0, 11), at(0, 12)),
      listed("c", "Tomorrow", at(2, 11), at(2, 12)),
      listed("d", "Late night", at(0, 23), at(1, 1)),
    ];
    expect(dayOtherEvents(events, invite).map(e => e.title)).toEqual(["Dentist", "Late night"]);
  });

  it("leaves out the invite's own event, including one occurrence of it", () => {
    const events = [
      listed("q4", "Q4 kickoff", at(1, 10, 30), at(1, 11, 30), { response_status: "needsAction" }),
      listed("q4_20261001T133000Z", "Q4 kickoff", at(1, 10, 30), at(1, 11, 30), { recurring_event_id: "q4" }),
    ];
    expect(dayOtherEvents(events, invite)).toEqual([]);
  });

  it("leaves out declined, cancelled and all-day events", () => {
    const events = [
      listed("a", "Declined", at(1, 9), at(1, 10), { response_status: "declined" }),
      listed("b", "Cancelled", at(1, 9), at(1, 10), { status: "cancelled" }),
      listed("c", "Holiday", Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 2), { all_day: true }),
    ];
    expect(dayOtherEvents(events, invite)).toEqual([]);
  });

  it("reads an event without an end as instant", () => {
    expect(dayOtherEvents([listed("a", "Call", at(1, 9), at(1, 9), { end_time: null })], invite))
      .toEqual([{ title: "Call", start: at(1, 9), end: at(1, 9) }]);
  });
});

describe("stripLayout", () => {
  const slot = { start: at(1, 10, 30), end: at(1, 11, 30) };
  const before = at(1, 7);

  it("places the slot within the window as percentages", () => {
    const layout = stripLayout(slot, [], before);
    expect(layout.slot.left).toBeCloseTo(20.833, 2);
    expect(layout.slot.width).toBeCloseTo(8.333, 2);
  });

  it("puts noon on its own tick", () => {
    expect(stripLayout(slot, [], before).noonAt).toBeCloseTo(33.333, 2);
    expect(stripLayout({ start: at(1, 21), end: at(1, 23) }, [], before).noonAt).toBeCloseTo(8.333, 2);
    expect(stripLayout({ start: at(1, 2), end: at(1, 3) }, [], before).noonAt).toBeCloseTo(83.333, 2);
    expect(stripLayout({ start: at(1, 23), end: at(2, 0) }, [], before).noonAt).toBeNull();
  });

  it("draws other events as busy blocks and marks the ones that overlap", () => {
    const layout = stripLayout(slot, [
      { title: "Dentist", start: at(1, 11), end: at(1, 12) },
      { title: "Lunch", start: at(1, 15), end: at(1, 15, 30) },
    ], before);
    expect(layout.busy.map(b => [b.title, b.overlap])).toEqual([["Dentist", true], ["Lunch", false]]);
    expect(layout.busy[0].left).toBeCloseTo(25, 2);
    expect(layout.busy[0].width).toBeCloseTo(8.333, 2);
    expect(layout.clashes.map(c => c.title)).toEqual(["Dentist"]);
  });

  it("clips busy blocks at the window's edges and drops ones outside it", () => {
    const layout = stripLayout(slot, [
      { title: "Early", start: at(1, 7), end: at(1, 9) },
      { title: "Night", start: at(1, 21), end: at(1, 22) },
    ], before);
    expect(layout.busy).toHaveLength(1);
    expect(layout.busy[0]).toMatchObject({ title: "Early", left: 0 });
    expect(layout.busy[0].width).toBeCloseTo(8.333, 2);
  });

  it("shades the past and draws a now-line on the day itself", () => {
    const layout = stripLayout(slot, [], at(1, 9));
    expect(layout.nowAt).toBeCloseTo(8.333, 2);
    expect(layout.past).toBeCloseTo(8.333, 2);
  });

  it("has no now-line on another day", () => {
    const layout = stripLayout(slot, [], at(0, 9));
    expect(layout.nowAt).toBeNull();
    expect(layout.past).toBeNull();
  });

  it("moves the window with the event", () => {
    const layout = stripLayout({ start: at(1, 6, 30), end: at(1, 7, 30) }, [], before);
    expect(layout.window).toEqual({ start: at(1, 6), end: at(1, 18) });
    expect(layout.slot.left).toBeCloseTo(0.5 / 12 * 100, 2);
    expect(layout.slot.width).toBeCloseTo(1 / 12 * 100, 2);
    expect(layout.window.end - layout.window.start).toBe(12 * HOUR);
  });
});
