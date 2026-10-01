import { describe, expect, it } from "vitest";
import { threadGroupHeading } from "./groupHeading";

const L = "en-US";
const at = (month: number, day: number, hour = 12, year = 2026) => new Date(year, month - 1, day, hour).getTime();
const heading = (label: string, dates: number[], now: Date) => threadGroupHeading(label, dates, now, L);

// Thursday, Oct 1 2026; Monday, Oct 5; Saturday, Oct 31
const thu = new Date(2026, 9, 1, 15, 10);
const mon = new Date(2026, 9, 5, 9, 0);
const sat = new Date(2026, 9, 31, 11, 0);

describe("threadGroupHeading", () => {
  it("leaves Today and Yesterday as they are, rows on the clock", () => {
    expect(heading("Today", [at(10, 1, 9)], thu)).toEqual({ text: "Today", oneDay: true });
    expect(heading("Yesterday", [at(9, 30, 17)], thu)).toEqual({ text: "Yesterday", oneDay: true });
  });

  it("names the day when the group holds only one", () => {
    expect(heading("This week", [at(9, 29, 9), at(9, 29, 17)], thu)).toEqual({ text: "Tuesday", oneDay: true });
    expect(heading("Last 30 days", [at(9, 26)], thu)).toEqual({ text: "Saturday", oneDay: true });
  });

  it("adds the date to a single day more than a week back", () => {
    expect(heading("Last 30 days", [at(9, 22, 14)], thu)).toEqual({ text: "Tuesday, Sep 22", oneDay: true });
  });

  it("calls several days since Monday earlier this week", () => {
    expect(heading("This week", [at(9, 28), at(9, 29)], thu)).toEqual({ text: "Earlier this week", oneDay: false });
  });

  it("names the weekday it reaches back to when it starts last week", () => {
    expect(heading("This week", [at(9, 25), at(9, 29)], thu)).toEqual({ text: "Since last Friday", oneDay: false });
  });

  it("names the month when every day is in it", () => {
    expect(heading("Last 30 days", [at(10, 2), at(10, 20)], sat)).toEqual({ text: "Earlier in October", oneDay: false });
    expect(heading("Last 30 days", [at(9, 9), at(9, 22)], thu)).toEqual({ text: "In September", oneDay: false });
    expect(heading("Last 30 days", [at(9, 9), at(9, 22)], mon)).toEqual({ text: "In September", oneDay: false });
  });

  it("names where the span starts when it crosses months", () => {
    expect(heading("Last 30 days", [at(9, 3), at(10, 1)], new Date(2026, 9, 2, 9))).toEqual({ text: "Since Sep 3", oneDay: false });
  });

  it("names the month or the year of older mail, or leaves it Older across years", () => {
    expect(heading("Older", [at(8, 14), at(8, 2)], thu)).toEqual({ text: "In August", oneDay: false });
    expect(heading("Older", [at(12, 3, 12, 2025), at(12, 9, 12, 2025)], thu)).toEqual({ text: "In December 2025", oneDay: false });
    expect(heading("Older", [at(8, 14), at(3, 2)], thu)).toEqual({ text: "Earlier in 2026", oneDay: false });
    expect(heading("Older", [at(3, 2, 12, 2025), at(11, 2, 12, 2025)], thu)).toEqual({ text: "In 2025", oneDay: false });
    expect(heading("Older", [at(8, 14), at(3, 2, 12, 2025)], thu)).toEqual({ text: "Older", oneDay: false });
  });

  it("keeps groups that aren't days, and empty ones, as they are", () => {
    expect(heading("Ana Pérez", [at(9, 29)], thu)).toEqual({ text: "Ana Pérez", oneDay: false });
    expect(heading("This week", [], thu)).toEqual({ text: "This week", oneDay: false });
  });

  it("names Today in the locale, like calendar days", () => {
    expect(threadGroupHeading("Today", [at(10, 1)], thu, "es-AR").text).toBe("Hoy");
  });
});
