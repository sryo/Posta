import { describe, expect, it } from "vitest";
import { dragTo, firstHourFor, formatDuration, minuteAt, nudge, panFirstHour, percentOf, placeAt } from "./dayTimeline";

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

describe("firstHourFor", () => {
  it("shows 8 a.m. to 8 p.m. for a slot inside it", () => {
    expect(firstHourFor({ start: h(10), end: h(11) })).toBe(8);
  });

  it("keeps the current view while the slot fits", () => {
    expect(firstHourFor({ start: h(10), end: h(11) }, 6)).toBe(6);
  });

  it("moves back to an early slot and forward to a late one, within the day", () => {
    expect(firstHourFor({ start: h(6, 30), end: h(7) })).toBe(6);
    expect(firstHourFor({ start: h(21), end: h(22, 15) })).toBe(11);
    expect(firstHourFor({ start: h(23), end: h(24) })).toBe(12);
  });
});

describe("the view", () => {
  it("pans by hours without leaving the day", () => {
    expect(panFirstHour(8, 1)).toBe(9);
    expect(panFirstHour(12, 1)).toBe(12);
    expect(panFirstHour(0, -1)).toBe(0);
  });

  it("maps positions to snapped minutes and back", () => {
    expect(minuteAt(0.5, 8)).toBe(h(14));
    expect(minuteAt(0.52, 8)).toBe(h(14, 15));
    expect(minuteAt(2, 8)).toBe(h(20));
    expect(percentOf(h(14), 8)).toBe(50);
    expect(percentOf(h(6), 8)).toBe(0);
  });
});

describe("dragTo", () => {
  const slot = { start: h(10), end: h(11) };

  it("moves the whole slot by the dragged distance, snapped", () => {
    expect(dragTo("move", slot, h(10, 30), h(12, 20))).toEqual({ start: h(11, 45), end: h(12, 45) });
  });

  it("keeps a moved slot on the day", () => {
    expect(dragTo("move", slot, h(10), h(25))).toEqual({ start: h(23), end: h(24) });
    expect(dragTo("move", slot, h(10), h(-2))).toEqual({ start: 0, end: h(1) });
  });

  it("resizes by either edge, never below a step", () => {
    expect(dragTo("start", slot, h(10), h(9, 20))).toEqual({ start: h(9, 15), end: h(11) });
    expect(dragTo("start", slot, h(10), h(12))).toEqual({ start: h(10, 45), end: h(11) });
    expect(dragTo("end", slot, h(11), h(9))).toEqual({ start: h(10), end: h(10, 15) });
  });

  it("draws a new slot either way", () => {
    expect(dragTo("draw", slot, h(14), h(15, 30))).toEqual({ start: h(14), end: h(15, 30) });
    expect(dragTo("draw", slot, h(15, 30), h(14))).toEqual({ start: h(14), end: h(15, 30) });
    expect(dragTo("draw", slot, h(14), h(14))).toEqual({ start: h(14), end: h(14, 15) });
  });

  it("places a slot at a minute, keeping its length", () => {
    expect(placeAt(slot, h(15, 10))).toEqual({ start: h(15, 15), end: h(16, 15) });
  });
});

describe("nudge", () => {
  it("moves or resizes by steps", () => {
    const slot = { start: h(10), end: h(10, 30) };
    expect(nudge(slot, 1)).toEqual({ start: h(10, 15), end: h(10, 45) });
    expect(nudge(slot, -1, true)).toEqual({ start: h(10), end: h(10, 15) });
    expect(nudge(slot, -1, true)).toEqual(nudge(nudge(slot, -1, true), -1, true));
  });
});

describe("formatDuration", () => {
  it("reads minutes and hours", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(90)).toBe("1 h 30 min");
  });
});
