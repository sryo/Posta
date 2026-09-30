import { describe, expect, it } from "vitest";
import { ALL_ACCOUNTS } from "./accountScope";
import { RECENT_SEARCHES_MAX, forgetSearch, keptCardName, parseRecentSearches, rememberSearch, searchCard, SEARCH_CARD_ID } from "./quickSearch";

describe("searchCard", () => {
  it("searches every account under the reserved id", () => {
    const card = searchCard("  from:ana ");
    expect(card).toMatchObject({ id: SEARCH_CARD_ID, account_id: ALL_ACCOUNTS, query: "from:ana", name: "from:ana", card_type: "email" });
  });

  it("is a calendar card for a calendar query", () => {
    expect(searchCard("calendar:today").card_type).toBe("calendar");
  });
});

describe("keptCardName", () => {
  it("reads the query in plain words", () => {
    expect(keptCardName("has:attachment")).toBe("With attachments");
    expect(keptCardName("from:ana@x.com")).toBe("From ana@x.com");
    expect(keptCardName("calendar:today")).toBe("Events today");
  });

  it("falls back to the query when it can't be read", () => {
    expect(keptCardName("(a OR b)")).toBe("(a OR b)");
  });

  it("shortens a long name", () => {
    const name = keptCardName("x".repeat(80));
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name.endsWith("…")).toBe(true);
  });
});

describe("forgetSearch", () => {
  it("drops only the search asked to be forgotten, keeping the others' order", () => {
    expect(forgetSearch(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    expect(forgetSearch(["a"], "z")).toEqual(["a"]);
  });
});

describe("rememberSearch", () => {
  it("puts the newest first without repeats", () => {
    expect(rememberSearch(["a", "b"], "b")).toEqual(["b", "a"]);
  });

  it("ignores a blank query", () => {
    expect(rememberSearch(["a"], "  ")).toEqual(["a"]);
  });

  it("keeps only the most recent", () => {
    const many = Array.from({ length: RECENT_SEARCHES_MAX }, (_, i) => `q${i}`);
    expect(rememberSearch(many, "new")).toHaveLength(RECENT_SEARCHES_MAX);
    expect(rememberSearch(many, "new")[0]).toBe("new");
  });
});

describe("parseRecentSearches", () => {
  it("reads a stored list", () => {
    expect(parseRecentSearches('["a","b"]')).toEqual(["a", "b"]);
  });

  it("is empty for missing or broken storage", () => {
    expect(parseRecentSearches(null)).toEqual([]);
    expect(parseRecentSearches("{")).toEqual([]);
    expect(parseRecentSearches('{"a":1}')).toEqual([]);
    expect(parseRecentSearches('[1,"",  "ok"]')).toEqual(["ok"]);
  });
});

