import { describe, expect, it } from "vitest";
import {
  cancellationStyle,
  createPostmarkLedger,
  emptyLabel,
  emptyLine,
  ringFontSize,
  ringText,
  spokenClock,
  stampClock,
  stampDate,
  stampTilt,
} from "./postmark";

const at = (h: number, m: number, day = 29) => new Date(2026, 8, day, h, m);

describe("emptyLine", () => {
  const MAIL = ["Nothing left to sort.", "All delivered.", "Pile's empty."];

  it("picks a mail line from the set, the same one for the same card", () => {
    const line = emptyLine("mail", "card-a", "is:unread", at(14, 14));
    expect(MAIL).toContain(line);
    expect(emptyLine("mail", "card-a", "is:unread", at(9, 3))).toBe(line);
  });

  it("spreads different cards across the set", () => {
    const lines = new Set(Array.from({ length: 30 }, (_, i) => emptyLine("mail", `card-${i}`, "", at(10, 0))));
    expect([...lines].sort()).toEqual([...MAIL].sort());
  });

  it("says see you tomorrow in the evening", () => {
    expect(emptyLine("mail", "card-a", "", at(18, 0))).toBe("All delivered. See you tomorrow.");
    expect(emptyLine("mail", "card-a", "", at(23, 59))).toBe("All delivered. See you tomorrow.");
    expect(emptyLine("mail", "card-a", "", at(17, 59))).not.toBe("All delivered. See you tomorrow.");
  });

  it("speaks of the calendar card's own range", () => {
    expect(emptyLine("calendar", "c", "calendar:today", at(10, 0))).toBe("Nothing left today.");
    expect(emptyLine("calendar", "c", "calendar:0d", at(10, 0))).toBe("Nothing left today.");
    expect(emptyLine("calendar", "c", "calendar:tomorrow", at(10, 0))).toBe("Tomorrow's free.");
    expect(emptyLine("calendar", "c", "calendar:week", at(10, 0))).toBe("Nothing coming up.");
    expect(emptyLine("calendar", "c", "calendar:today", at(21, 0))).toBe("Nothing left today.");
  });
});

describe("stamp clock and date", () => {
  it("writes a 12-hour time over its meridiem", () => {
    expect(stampClock(at(14, 14), "en-US")).toEqual({ time: "2:14", meridiem: "PM" });
    expect(stampClock(at(0, 5), "en-US")).toEqual({ time: "12:05", meridiem: "AM" });
    expect(stampClock(at(12, 0), "en-US")).toEqual({ time: "12:00", meridiem: "PM" });
  });

  it("writes a 24-hour time alone where the locale uses one", () => {
    expect(stampClock(at(14, 14), "en-GB")).toEqual({ time: "14:14", meridiem: null });
    expect(stampClock(at(9, 5), "en-GB")).toEqual({ time: "09:05", meridiem: null });
  });

  it("speaks the time as a sentence would", () => {
    expect(spokenClock(at(14, 14), "en-US")).toBe("2:14 p.m.");
    expect(spokenClock(at(9, 40), "en-US")).toBe("9:40 a.m.");
    expect(spokenClock(at(21, 40), "en-GB")).toBe("21:40");
  });

  it("dates the stamp day, month, year in capitals", () => {
    expect(stampDate(at(14, 14))).toBe("29 SEP 2026");
    expect(stampDate(new Date(2027, 0, 3))).toBe("3 JAN 2027");
  });
});

describe("stamp shape", () => {
  it("tilts each card by a stable whole angle within 8 degrees", () => {
    const tilts = Array.from({ length: 200 }, (_, i) => stampTilt(`card-${i}`));
    for (const t of tilts) {
      expect(Number.isInteger(t)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(-8);
      expect(t).toBeLessThanOrEqual(8);
    }
    expect(new Set(tilts).size).toBeGreaterThan(10);
    expect(stampTilt("card-7")).toBe(stampTilt("card-7"));
  });

  it("cancels with waves or straight bars by weekday", () => {
    // 27 Sep 2026 is a Sunday
    const week = [27, 28, 29, 30, 31, 32, 33].map(d => cancellationStyle(new Date(2026, 8, d, 12)));
    expect(week).toEqual(["waves", "bars", "waves", "bars", "waves", "bars", "waves"]);
  });

  it("rings the card's name with the app's", () => {
    expect(ringText("Hot")).toBe("HOT · POSTA");
    expect(ringText("  Waiting on replies ")).toBe("WAITING… · POSTA");
  });

  it("shrinks a long ring so it fits the arc", () => {
    expect(ringFontSize("HOT · POSTA")).toBe(7.5);
    expect(ringFontSize("WAITING… · POSTA")).toBeCloseTo(7.5 * 11 / 16);
  });
});

describe("emptyLabel", () => {
  it("names the card, when it emptied and its query", () => {
    expect(emptyLabel("Hot", at(14, 14), "is:important newer_than:1d", "en-US"))
      .toBe("Hot is empty. Cleared at 2:14 p.m. Query: is:important newer_than:1d");
  });
});

describe("postmark ledger", () => {
  function ledger(start = at(14, 14)) {
    let now = start;
    const l = createPostmarkLedger(() => now);
    return { l, tick: (d: Date) => { now = d; } };
  }

  it("lands the stamp when a card with threads empties", () => {
    const { l } = ledger();
    l.sawContent("a", "q");
    expect(l.emptied("a", "q")).toEqual({ clearedAt: at(14, 14), lands: true });
  });

  it("does not land on a card that was empty from the start", () => {
    const { l } = ledger();
    expect(l.emptied("a", "q")).toEqual({ clearedAt: at(14, 14), lands: false });
  });

  it("lands only once and keeps the first clearing time", () => {
    const { l, tick } = ledger();
    l.sawContent("a", "q");
    l.emptied("a", "q");
    tick(at(15, 0));
    expect(l.emptied("a", "q")).toEqual({ clearedAt: at(14, 14), lands: false });
  });

  it("stamps anew when the card fills and empties again", () => {
    const { l, tick } = ledger();
    l.sawContent("a", "q");
    l.emptied("a", "q");
    tick(at(16, 30));
    l.sawContent("a", "q");
    expect(l.emptied("a", "q")).toEqual({ clearedAt: at(16, 30), lands: true });
  });

  it("keeps cards apart", () => {
    const { l } = ledger();
    l.sawContent("a", "q");
    expect(l.emptied("b", "q").lands).toBe(false);
    expect(l.emptied("a", "q").lands).toBe(true);
  });

  it("starts over when the card's query changes", () => {
    const { l } = ledger();
    l.sawContent("a", "is:unread");
    expect(l.emptied("a", "is:starred").lands).toBe(false);
    expect(l.emptied("a", " is:unread ").lands).toBe(true);
  });
});
