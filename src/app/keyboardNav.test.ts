import { describe, expect, it } from "vitest";
import { escapeTarget, focusEdgeHint, nextCardFocus, nextItemFocus } from "./keyboardNav";

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

  it("stops at the last item and names the edge instead of leaving the card", () => {
    expect(nextItemFocus(cards, { cardId: "a", index: 1 }, true)).toEqual({ edge: "last", cardId: "a" });
    expect(nextItemFocus(cards, { cardId: "c", index: 2 }, true)).toEqual({ edge: "last", cardId: "c" });
  });

  it("stops at the first item and names that edge too", () => {
    expect(nextItemFocus(cards, { cardId: "c", index: 0 }, false)).toEqual({ edge: "first", cardId: "c" });
    expect(nextItemFocus(cards, { cardId: "a", index: -1 }, false)).toEqual({ edge: "first", cardId: "a" });
  });

  it("calls an empty card's every move an edge", () => {
    expect(nextItemFocus(cards, { cardId: "b", index: -1 }, true)).toEqual({ edge: "last", cardId: "b" });
    expect(nextItemFocus(cards, { cardId: "b", index: 0 }, false)).toEqual({ edge: "first", cardId: "b" });
  });

  it("goes down from the card itself to its first item", () => {
    expect(nextItemFocus(cards, { cardId: "c", index: -1 }, true)).toEqual({ cardId: "c", index: 0 });
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

  it("opens the add card form past the last card and names the edge before the first", () => {
    expect(nextCardFocus(ids, "c", true, false)).toEqual({ cardId: null, addingCard: true });
    expect(nextCardFocus(ids, "a", false, false)).toEqual({ edge: "firstCard", cardId: "a" });
  });

  it("does nothing without cards", () => {
    expect(nextCardFocus([], null, true, false)).toBeNull();
  });
});

describe("focusEdgeHint", () => {
  const board = [{ id: "a", name: "Inbox", count: 5 }, { id: "b", name: "Receipts", count: 0 }, { id: "c", name: "Later", count: 2 }];

  it("counts the card's rows at its end and names the key to the next card", () => {
    expect(focusEdgeHint({ edge: "last", cardId: "a" }, board)).toEqual({ text: "Last of 5 in Inbox", key: "l", next: "Receipts" });
  });

  it("names no next card past the last one", () => {
    expect(focusEdgeHint({ edge: "last", cardId: "c" }, board)).toEqual({ text: "Last of 2 in Later" });
  });

  it("says the card is empty when it has no rows", () => {
    expect(focusEdgeHint({ edge: "last", cardId: "b" }, board)).toEqual({ text: "Nothing in Receipts", key: "l", next: "Later" });
  });

  it("names the top of a card and the first card", () => {
    expect(focusEdgeHint({ edge: "first", cardId: "c" }, board)).toEqual({ text: "First in Later" });
    expect(focusEdgeHint({ edge: "firstCard", cardId: "a" }, board)).toEqual({ text: "Inbox is the first card" });
  });

  it("says nothing for a card no longer on the board", () => {
    expect(focusEdgeHint({ edge: "last", cardId: "gone" }, board)).toBeNull();
  });
});

describe("escapeTarget", () => {
  const none = {
    filter: false, accountChooser: false, colorPicker: false, batchReply: false,
    compose: false, cardEditor: false, settings: false,
    actionConfigMenu: false, selection: false, cardFocus: false,
  };

  it("closes one thing per press, the one most in front first", () => {
    const all = Object.fromEntries(Object.keys(none).map(k => [k, true])) as typeof none;
    const order: string[] = [];
    let open = { ...all };
    for (let target = escapeTarget(open); target; target = escapeTarget(open)) {
      order.push(target);
      open = { ...open, [target]: false };
    }
    expect(order).toEqual([
      "filter", "accountChooser", "colorPicker", "batchReply", "compose", "cardEditor", "settings", "actionConfigMenu", "selection", "cardFocus",
    ]);
  });

  it("has nothing to close when nothing is open", () => {
    expect(escapeTarget(none)).toBeNull();
  });
});
