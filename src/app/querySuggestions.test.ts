import { describe, expect, it } from "vitest";
import type { RecentContact } from "./contacts";
import { labelQueryValue, querySuggestions } from "./querySuggestions";

const contact = (email: string, name?: string, frequency = 1): RecentContact => ({
  email, name, frequency, lastContacted: 0, fromGoogle: false,
});

describe("querySuggestions", () => {
  it("suggests operators for the word being typed, replacing only that word", () => {
    const suggestions = querySuggestions("is:unread fro", [], []);
    expect(suggestions[0]).toEqual({ text: "from:", desc: "Sender address", replace: { start: 10, end: 13 } });
  });

  it("matches operators containing two or more typed letters", () => {
    expect(querySuggestions("ttach", [], []).map(s => s.text)).toContain("has:attachment");
    expect(querySuggestions("t", [], []).map(s => s.text)).not.toContain("has:attachment");
  });

  it("offers at most eight operators", () => {
    expect(querySuggestions("e", [], []).length).toBeLessThanOrEqual(8);
  });

  it("completes an address operator from contacts", () => {
    const suggestions = querySuggestions("from:an", [contact("ana@x.com", "Ana", 3), contact("bo@x.com")], []);
    expect(suggestions).toEqual([{ text: "from:ana@x.com", desc: "Ana (3 emails)", replace: { start: 0, end: 7 } }]);
  });

  it("suggests nothing for an empty query, a trailing space or an address operator with no text", () => {
    expect(querySuggestions("", [], [])).toEqual([]);
    expect(querySuggestions("from:x ", [], [])).toEqual([]);
    expect(querySuggestions("from:", [contact("ana@x.com")], [])).toEqual([]);
  });

  it("completes label: from the account's labels in the form Gmail searches for", () => {
    const suggestions = querySuggestions("is:unread label:wo", [], ["Work/Projects", "Travel", "Work notes"]);
    expect(suggestions).toEqual([
      { text: "label:work-projects", desc: "Work/Projects", replace: { start: 10, end: 18 } },
      { text: "label:work-notes", desc: "Work notes", replace: { start: 10, end: 18 } },
    ]);
    expect(querySuggestions("label:", [], ["Travel"]).map(s => s.text)).toEqual(["label:travel"]);
  });
});

describe("querySuggestions at the caret", () => {
  it("completes the word the caret is in, not the last one", () => {
    const suggestions = querySuggestions("is:unr newer_than:7d", [], [], 6);
    expect(suggestions[0]).toEqual({ text: "is:unread", desc: "Unread messages", replace: { start: 0, end: 6 } });
  });

  it("suggests nothing when the caret sits on a space", () => {
    expect(querySuggestions("is:unread  from:a", [], [], 10)).toEqual([]);
  });
});

describe("querySuggestions for calendar queries", () => {
  it("offers calendar ranges when the query starts with calendar", () => {
    expect(querySuggestions("calendar:w", [], []).map(s => s.text)).toEqual(["calendar:week"]);
    expect(querySuggestions("cal", [], []).map(s => s.text)).toContain("calendar:today");
  });

  it("offers calendar operators, not email ones, after a leading calendar: token", () => {
    const texts = querySuggestions("calendar:week wi", [], []).map(s => s.text);
    expect(texts).toContain("with:");
    expect(querySuggestions("calendar:week is:", [], []).map(s => s.text)).not.toContain("is:unread");
  });

  it("completes with: from contacts", () => {
    const suggestions = querySuggestions("calendar:week with:an", [contact("ana@x.com", "Ana", 2)], []);
    expect(suggestions.map(s => s.text)).toEqual(["with:ana@x.com"]);
  });

  it("doesn't offer calendar: after an email query's first word", () => {
    expect(querySuggestions("is:unread cal", [], []).map(s => s.text)).not.toContain("calendar:today");
  });
});

describe("contact suggestion counts", () => {
  it("says 1 email, and leaves out a count of zero", () => {
    const one = querySuggestions("from:an", [contact("ana@x.com", "Ana", 1)], []);
    expect(one[0].desc).toBe("Ana (1 email)");
    const none = querySuggestions("from:an", [contact("ana@x.com", "Ana", 0), contact("andy@x.com", undefined, 0)], []);
    expect(none.map(s => s.desc)).toEqual(["Ana", ""]);
  });
});

describe("labelQueryValue", () => {
  it("lowercases and hyphenates spaces and slashes", () => {
    expect(labelQueryValue("Work/Big Projects")).toBe("work-big-projects");
  });
});
