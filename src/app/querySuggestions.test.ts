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

describe("labelQueryValue", () => {
  it("lowercases and hyphenates spaces and slashes", () => {
    expect(labelQueryValue("Work/Big Projects")).toBe("work-big-projects");
  });
});
