import { describe, expect, it, vi } from "vitest";
import {
  appLocale,
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

describe("appLocale", () => {
  const aug20 = new Date(2026, 7, 20, 6, 27);

  it("keeps an English system locale as it is", () => {
    expect(appLocale("en-GB")).toBe("en-GB");
    expect(appLocale("en-US")).toBe("en-US");
  });

  it("writes dates in English, the app's language, in the system region's order and clock", () => {
    expect(formatShortDate(aug20, appLocale("es-ES"))).toBe("20 Aug");
    expect(formatClock(aug20, appLocale("es-ES"))).toBe("06:27");
    expect(formatShortDate(aug20, appLocale("es-419"))).toBe("20 Aug");
    expect(uses12HourClock(appLocale("es-419"))).toBe(true);
    expect(formatClock(aug20, appLocale("de-DE"))).toBe("06:27");
    expect(relativeDayName(aug20, aug20, appLocale("es-419"))).toBe("Today");
  });

  it("is what every formatter uses when no locale is given", () => {
    const language = vi.spyOn(navigator, "language", "get").mockReturnValue("es-419");
    expect(formatShortDate(aug20)).toBe("20 Aug");
    expect(formatDayLabel(aug20, aug20)).toBe("Today");
    expect(threadGroupLabel("Today")).toBe("Today");
    language.mockRestore();
  });
});
