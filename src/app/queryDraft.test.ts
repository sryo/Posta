import { describe, expect, it } from "vitest";
import {
  composeQuery,
  commitTyped,
  draftAtEnd,
  draftAtWord,
  editPrevious,
  stepLeft,
  stepRight,
  suggestionContext,
} from "./queryDraft";

describe("composeQuery", () => {
  it("joins the words before the draft, the draft and the words after it", () => {
    expect(composeQuery({ head: "is:unread", draft: "from:ana", tail: "invoice" })).toBe("is:unread from:ana invoice");
    expect(composeQuery({ head: "", draft: "  ", tail: "invoice" })).toBe("invoice");
    expect(composeQuery({ head: "is:unread", draft: "", tail: "" })).toBe("is:unread");
  });
});

describe("draftAtEnd", () => {
  it("starts typing after every word of the query", () => {
    expect(draftAtEnd(" is:unread invoice ")).toEqual({ head: "is:unread invoice", draft: "", tail: "" });
  });
});

describe("draftAtWord", () => {
  it("makes one word the text being edited, with the caret after it", () => {
    expect(draftAtWord("is:unread newer_than:7d invoice", 1)).toEqual({
      draft: { head: "is:unread", draft: "newer_than:7d", tail: "invoice" },
      caret: "newer_than:7d".length,
    });
  });
});

describe("commitTyped", () => {
  it("turns the words typed before a space into finished words", () => {
    expect(commitTyped({ head: "is:unread", draft: "from:ana ", tail: "invoice" }, 9)).toEqual({
      draft: { head: "is:unread from:ana", draft: "", tail: "invoice" },
      caret: 0,
    });
  });

  it("keeps the text after the caret in the draft", () => {
    expect(commitTyped({ head: "", draft: "is:unread newer_than:7d", tail: "" }, 10)).toEqual({
      draft: { head: "is:unread", draft: "newer_than:7d", tail: "" },
      caret: 0,
    });
  });

  it("finishes every word before the last space, as after a paste", () => {
    expect(commitTyped({ head: "", draft: "from:a newer_than:7d invo", tail: "" }, 25)).toEqual({
      draft: { head: "from:a newer_than:7d", draft: "invo", tail: "" },
      caret: 4,
    });
    expect(commitTyped({ head: "", draft: 'subject:"big news" invo', tail: "" }, 23)).toEqual({
      draft: { head: 'subject:"big news"', draft: "invo", tail: "" },
      caret: 4,
    });
  });

  it("waits while the caret is inside a word, a quoted phrase or a group", () => {
    const typing = { head: "", draft: 'subject:"big news ', tail: "" };
    expect(commitTyped(typing, typing.draft.length)).toEqual({ draft: typing, caret: typing.draft.length });
    const group = { head: "", draft: "(from:a OR ", tail: "" };
    expect(commitTyped(group, group.draft.length)).toEqual({ draft: group, caret: group.draft.length });
    const word = { head: "", draft: "is:unr", tail: "" };
    expect(commitTyped(word, 6)).toEqual({ draft: word, caret: 6 });
  });
});

describe("moving between words", () => {
  it("steps the draft left past the previous word, finishing what was typed", () => {
    expect(stepLeft({ head: "is:unread from:ana", draft: "invo", tail: "has:attachment" })).toEqual({
      head: "is:unread", draft: "", tail: "from:ana invo has:attachment",
    });
    expect(stepLeft({ head: "", draft: "x", tail: "y" })).toBeNull();
  });

  it("steps the draft right past the next word", () => {
    expect(stepRight({ head: "is:unread", draft: "invo", tail: "from:ana has:attachment" })).toEqual({
      head: "is:unread invo from:ana", draft: "", tail: "has:attachment",
    });
    expect(stepRight({ head: "x", draft: "y", tail: "" })).toBeNull();
  });

  it("takes the previous word back into the draft to edit it", () => {
    expect(editPrevious({ head: "is:unread from:ana", draft: "invoice", tail: "" })).toEqual({
      draft: { head: "is:unread", draft: "from:ana invoice", tail: "" },
      caret: "from:ana".length,
    });
    expect(editPrevious({ head: "", draft: "x", tail: "" })).toBeNull();
  });
});

describe("suggestionContext", () => {
  it("gives the query up to the draft, so the words after it aren't completed", () => {
    expect(suggestionContext({ head: "calendar:week", draft: "wi", tail: "invoice" }, 2)).toEqual({
      query: "calendar:week wi", caret: 16, offset: 14,
    });
    expect(suggestionContext({ head: "", draft: "is:", tail: "invoice" }, 3)).toEqual({ query: "is:", caret: 3, offset: 0 });
  });
});
