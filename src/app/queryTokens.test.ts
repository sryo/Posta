import { describe, expect, it } from "vitest";
import { calendarRangeError, describeQuery, joinQueryWords, queryWords, removeWord, replaceWord } from "./queryTokens";

describe("queryWords", () => {
  it("splits a query into operator chips and plain words", () => {
    expect(queryWords("from:ana@x.com is:unread invoice")).toEqual([
      { text: "from:ana@x.com", operator: { op: "from", value: "ana@x.com", negated: false } },
      { text: "is:unread", operator: { op: "is", value: "unread", negated: false } },
      { text: "invoice", operator: null },
    ]);
  });

  it("keeps quoted values together and recognises a negated operator", () => {
    expect(queryWords('subject:"weekly report" -is:starred')).toEqual([
      { text: 'subject:"weekly report"', operator: { op: "subject", value: "weekly report", negated: false } },
      { text: "-is:starred", operator: { op: "is", value: "starred", negated: true } },
    ]);
  });

  it("leaves OR, parentheses, unknown operators and empty values as raw words", () => {
    const words = queryWords("(from:a OR from:b) foo:bar from:");
    expect(words.map(w => w.text)).toEqual(["(from:a OR from:b)", "foo:bar", "from:"]);
    expect(words.every(w => w.operator === null)).toBe(true);
  });

  it("round-trips the query's words", () => {
    const query = 'category:promotions OR category:updates -"team sync"';
    expect(joinQueryWords(queryWords(query).map(w => w.text))).toBe(query);
  });
});

describe("editing words", () => {
  it("removes one word", () => {
    expect(removeWord("is:unread from:ana invoice", 1)).toBe("is:unread invoice");
  });

  it("replaces one word", () => {
    expect(replaceWord("is:unread from:ana invoice", 1, "from:bo@x.com")).toBe("is:unread from:bo@x.com invoice");
  });
});

describe("describeQuery", () => {
  it("explains a calendar query", () => {
    expect(describeQuery("calendar:7d with:Ana")).toBe("Events in the next 7 days · with Ana");
    expect(describeQuery("calendar:today response:needsAction")).toBe("Events today · you haven't answered");
    expect(describeQuery("calendar:week -standup")).toBe("Events in the next 7 days · without “standup”");
  });

  it("explains an email query", () => {
    expect(describeQuery("from:boss is:unread newer_than:7d")).toBe("Emails from boss · unread · from the last 7 days");
    expect(describeQuery("in:inbox is:important -has:attachment")).toBe("Emails in the inbox · important · without attachments");
    expect(describeQuery("label:work invoice")).toBe("Emails labelled work · containing “invoice”");
    expect(describeQuery("is:inbox")).toBe("Emails in the inbox");
  });

  it("gives up on queries it can't explain in full", () => {
    expect(describeQuery("from:a OR from:b")).toBeNull();
    expect(describeQuery("")).toBeNull();
  });

  it("doesn't explain a query with an unknown calendar range", () => {
    expect(describeQuery("calendar:nextweek")).toBeNull();
  });
});

describe("calendarRangeError", () => {
  it("names an unknown range and the ones that work", () => {
    expect(calendarRangeError("calendar:nextweek with:ana")).toBe('Unknown range "nextweek". Try today, tomorrow, week, month, 7d, 2w');
  });

  it("accepts the named ranges and durations", () => {
    for (const q of ["calendar:today", "Calendar:WEEK", "calendar:3d", "calendar:2w", "calendar:1y", "is:unread"]) {
      expect(calendarRangeError(q)).toBeNull();
    }
    expect(calendarRangeError("calendar:0d")).not.toBeNull();
  });
});
