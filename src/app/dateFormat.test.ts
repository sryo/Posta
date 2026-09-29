import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatDayLabel,
  formatShortDate,
  formatWhen,
  monthNames,
  relativeDayName,
  shortWeekday,
  threadGroupLabel,
  uses12HourClock,
} from "./dateFormat";

const now = new Date(2026, 8, 29, 10, 0);
const at = (day: number, hour = 14, minute = 0) => new Date(2026, 8, day, hour, minute);

describe("formatClock", () => {
  it("follows the locale's clock", () => {
    expect(formatClock(at(29, 14, 5), "en-US")).toMatch(/^2:05\sPM$/);
    expect(formatClock(at(29, 14, 5), "en-GB")).toBe("14:05");
    expect(formatClock(at(29, 0, 41), "de-DE")).toBe("00:41");
  });
});

describe("uses12HourClock", () => {
  it("tells a 12-hour locale from a 24-hour one", () => {
    expect(uses12HourClock("en-US")).toBe(true);
    expect(uses12HourClock("en-GB")).toBe(false);
    expect(uses12HourClock("de-DE")).toBe(false);
  });
});

describe("relativeDayName", () => {
  it("names yesterday, today and tomorrow in the locale, capitalised", () => {
    expect(relativeDayName(at(29), now, "en-US")).toBe("Today");
    expect(relativeDayName(at(30), now, "en-US")).toBe("Tomorrow");
    expect(relativeDayName(at(28), now, "en-US")).toBe("Yesterday");
    expect(relativeDayName(at(29), now, "es-AR")).toBe("Hoy");
    expect(relativeDayName(at(30), now, "es-AR")).toBe("Mañana");
  });

  it("has no name for other days", () => {
    expect(relativeDayName(at(26), now, "en-US")).toBeNull();
    expect(relativeDayName(new Date(2026, 9, 1), now, "en-US")).toBeNull();
  });
});

describe("formatDayLabel", () => {
  it("uses the relative name when there is one, else the weekday and date, all in one locale", () => {
    expect(formatDayLabel(at(29), now, "es-AR")).toBe("Hoy");
    expect(formatDayLabel(new Date(2026, 9, 1), now, "es-AR")).toMatch(/^jueves,? 1 (de )?oct/);
    expect(formatDayLabel(new Date(2026, 9, 1), now, "en-US")).toBe("Thursday, Oct 1");
  });
});

describe("formatShortDate", () => {
  it("shows the month by name, and the year only when asked", () => {
    expect(formatShortDate(at(29), "en-US")).toBe("Sep 29");
    expect(formatShortDate(at(29), "en-US", { year: true })).toBe("Sep 29, 2026");
    expect(formatShortDate(at(29), "en-US", { weekday: true })).toBe("Tue, Sep 29");
  });
});

describe("formatWhen", () => {
  it("gives a relative day with the time, or the date with the time", () => {
    expect(formatWhen(at(29, 0, 42), now, "en-US")).toMatch(/^Today, 12:42\sAM$/);
    expect(formatWhen(at(22, 10, 14), now, "en-US")).toMatch(/^Sep 22, 10:14\sAM$/);
    expect(formatWhen(new Date(2025, 11, 1, 9, 0), now, "en-GB")).toBe("1 Dec 2025, 09:00");
  });
});

describe("weekday and month names", () => {
  it("come from the locale", () => {
    expect(shortWeekday(new Date(2026, 9, 1), "en-US")).toBe("Thu");
    expect(shortWeekday(new Date(2026, 9, 1), "es-AR")).toMatch(/^jue/);
    expect(monthNames("en-US")[0]).toBe("January");
    expect(monthNames("es-AR")[8]).toBe("septiembre");
  });
});

describe("threadGroupLabel", () => {
  it("names the Today and Yesterday groups in the locale, like calendar days", () => {
    expect(threadGroupLabel("Today", "es-AR")).toBe("Hoy");
    expect(threadGroupLabel("Yesterday", "en-US")).toBe("Yesterday");
    expect(threadGroupLabel("This week", "es-AR")).toBe("This week");
  });
});
