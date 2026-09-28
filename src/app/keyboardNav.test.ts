import { describe, expect, it } from "vitest";
import { nextCardFocus, nextItemFocus } from "./keyboardNav";

const cards = [{ id: "a", count: 2 }, { id: "b", count: 0 }, { id: "c", count: 3 }];

describe("nextItemFocus", () => {
  it("starts at the first card's first item, or on the card itself going up", () => {
    expect(nextItemFocus(cards, null, true)).toEqual({ cardId: "a", index: 0 });
    expect(nextItemFocus(cards, null, false)).toEqual({ cardId: "a", index: -1 });
  });

  it("moves within a card", () => {
    expect(nextItemFocus(cards, { cardId: "a", index: 0 }, true)).toEqual({ cardId: "a", index: 1 });
    expect(nextItemFocus(cards, { cardId: "c", index: 2 }, false)).toEqual({ cardId: "c", index: 1 });
  });

  it("continues into the next card, including an empty one", () => {
    expect(nextItemFocus(cards, { cardId: "a", index: 1 }, true)).toEqual({ cardId: "b", index: 0 });
    expect(nextItemFocus(cards, { cardId: "b", index: 0 }, true)).toEqual({ cardId: "c", index: 0 });
  });

  it("goes back to the previous card's last item from the first item", () => {
    expect(nextItemFocus(cards, { cardId: "c", index: 0 }, false)).toEqual({ cardId: "b", index: -1 });
    expect(nextItemFocus(cards, { cardId: "b", index: -1 }, false)).toBeNull();
    expect(nextItemFocus(cards, { cardId: "a", index: 0 }, false)).toBeNull();
  });

  it("stops at the last item of the last card", () => {
    expect(nextItemFocus(cards, { cardId: "c", index: 2 }, true)).toBeNull();
  });

  it("moves up from a focus left past the end of a list that shrank", () => {
    expect(nextItemFocus(cards, { cardId: "c", index: 7 }, false)).toEqual({ cardId: "c", index: 2 });
  });

  it("restarts at the first card when the focused card is no longer shown", () => {
    expect(nextItemFocus(cards, { cardId: "collapsed", index: 4 }, true)).toEqual({ cardId: "a", index: 0 });
  });

  it("does nothing without cards", () => {
    expect(nextItemFocus([], null, true)).toBeNull();
  });
});

describe("nextCardFocus", () => {
  const ids = ["a", "b", "c"];

  it("focuses the first card going right, the last going left, from no focus", () => {
    expect(nextCardFocus(ids, null, true, false)).toEqual({ cardId: "a", addingCard: false });
    expect(nextCardFocus(ids, null, false, false)).toEqual({ cardId: "c", addingCard: false });
  });

  it("goes from the add card form back to the last card", () => {
    expect(nextCardFocus(ids, null, false, true)).toEqual({ cardId: "c", addingCard: false });
  });

  it("moves between cards", () => {
    expect(nextCardFocus(ids, "a", true, false)).toEqual({ cardId: "b", addingCard: false });
    expect(nextCardFocus(ids, "b", false, false)).toEqual({ cardId: "a", addingCard: false });
  });

  it("opens the add card form past the last card and stays put before the first", () => {
    expect(nextCardFocus(ids, "c", true, false)).toEqual({ cardId: null, addingCard: true });
    expect(nextCardFocus(ids, "a", false, false)).toBeNull();
  });

  it("does nothing without cards", () => {
    expect(nextCardFocus([], null, true, false)).toBeNull();
  });
});
