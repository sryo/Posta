import { describe, expect, it } from "vitest";
import { lastLetterLine, latestDate, monthsBetween, transitGap, transitGaps } from "./transit";

const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe("monthsBetween", () => {
  it("counts whole calendar months, short of a month when the day hasn't come round", () => {
    expect(monthsBetween(day(2025, 8, 31), day(2025, 10, 1))).toBe(1);
    expect(monthsBetween(day(2025, 8, 21), day(2026, 10, 1))).toBe(13);
    expect(monthsBetween(day(2025, 8, 1), day(2026, 10, 1))).toBe(14);
    expect(monthsBetween(day(2025, 1, 31), day(2025, 2, 28))).toBe(0);
  });
});

describe("transitGap", () => {
  it("stamps nothing under 90 days", () => {
    expect(transitGap(day(2026, 1, 1), day(2026, 3, 31))).toBeNull();
    expect(transitGap(day(2026, 1, 1), day(2026, 1, 1))).toBeNull();
  });

  it("stamps at exactly 90 days, counted in calendar days whatever the hour", () => {
    // 1 Jan to 1 Apr 2026 is 90 days
    expect(transitGap(day(2026, 1, 1), day(2026, 4, 1))?.span).toBe("3 MONTHS");
    expect(transitGap(day(2026, 1, 1, 23), day(2026, 4, 1, 1))?.span).toBe("3 MONTHS");
    expect(transitGap(day(2026, 1, 1, 1), day(2026, 3, 31, 23))).toBeNull();
  });

  it("says at least two months at 90 days, never weeks", () => {
    // 30 Nov to 28 Feb: 90 days, two whole months
    expect(transitGap(day(2025, 11, 30), day(2026, 2, 28))?.span).toBe("2 MONTHS");
  });

  it("counts whole months under two years", () => {
    const gap = transitGap(day(2025, 8, 1), day(2026, 10, 1));
    expect(gap).toEqual({ span: "14 MONTHS", range: "AUG 2025 – OCT 2026", label: "14 months between letters." });
    expect(transitGap(day(2024, 10, 2), day(2026, 10, 1))?.span).toBe("23 MONTHS");
  });

  it("counts whole years from two years on", () => {
    expect(transitGap(day(2024, 10, 1), day(2026, 10, 1))?.span).toBe("2 YEARS");
    expect(transitGap(day(2020, 7, 14), day(2026, 10, 1))).toEqual({
      span: "6 YEARS",
      range: "JUL 2020 – OCT 2026",
      label: "6 years between letters.",
    });
  });

  it("dates both ends with their year, even in the same year", () => {
    expect(transitGap(day(2026, 1, 10), day(2026, 6, 1))?.range).toBe("JAN 2026 – JUN 2026");
  });

  it("stamps nothing when the later letter is dated earlier", () => {
    expect(transitGap(day(2026, 10, 1), day(2025, 1, 1))).toBeNull();
  });
});

describe("transitGaps", () => {
  const none = (n: number) => Array.from({ length: n }, () => false);

  it("puts a stamp before a message long after the one above it", () => {
    const gaps = transitGaps([day(2025, 8, 21), day(2025, 8, 30), day(2026, 10, 1)], none(3));
    expect(gaps.map(g => g?.span ?? null)).toEqual([null, null, "13 MONTHS"]);
  });

  it("stamps nothing in a thread of one message", () => {
    expect(transitGaps([day(2020, 1, 1)], none(1))).toEqual([null]);
  });

  it("counts a hidden message by its date: it broke the silence even unseen", () => {
    const dates = [day(2025, 1, 1), day(2025, 12, 1), day(2026, 1, 15)];
    expect(transitGaps(dates, [false, true, false])).toEqual([null, null, null]);
    const quiet = transitGaps([day(2025, 1, 1), day(2025, 2, 1), day(2026, 1, 15)], [false, true, false]);
    expect(quiet[2]?.range).toBe("FEB 2025 – JAN 2026");
  });

  it("never stamps a hidden message, nor one with only hidden messages above it", () => {
    expect(transitGaps([day(2020, 1, 1), day(2026, 1, 1)], [false, true])).toEqual([null, null]);
    expect(transitGaps([day(2020, 1, 1), day(2026, 1, 1)], [true, false])).toEqual([null, null]);
  });

  it("measures from the latest letter above, whatever order the thread lists them in", () => {
    const gaps = transitGaps([day(2026, 1, 1), day(2020, 1, 1), day(2026, 2, 1)], none(3));
    expect(gaps).toEqual([null, null, null]);
  });

  it("skips undated messages", () => {
    expect(transitGaps([day(2020, 1, 1), null, day(2026, 1, 1)], none(3)).map(g => g?.span ?? null))
      .toEqual([null, null, "6 YEARS"]);
    expect(transitGaps([null, day(2026, 1, 1)], none(2))).toEqual([null, null]);
  });
});

describe("lastLetterLine", () => {
  const now = day(2026, 10, 1);

  it("names the month of the last letter once it is a year old", () => {
    expect(lastLetterLine(day(2025, 10, 1), now)).toBe("Last letter here: Oct 2025.");
    expect(lastLetterLine(day(2025, 8, 21), now)).toBe("Last letter here: Aug 2025.");
    expect(lastLetterLine(day(2019, 3, 3), now)).toBe("Last letter here: Mar 2019.");
  });

  it("says nothing under a year, or with no date", () => {
    expect(lastLetterLine(day(2025, 10, 2), now)).toBeNull();
    expect(lastLetterLine(day(2026, 9, 1), now)).toBeNull();
    expect(lastLetterLine(null, now)).toBeNull();
  });
});

describe("latestDate", () => {
  it("picks the latest date, skipping undated letters", () => {
    expect(latestDate([day(2025, 3, 1), null, day(2026, 1, 1), day(2025, 12, 1)])).toEqual(day(2026, 1, 1));
    expect(latestDate([null])).toBeNull();
    expect(latestDate([])).toBeNull();
  });
});
