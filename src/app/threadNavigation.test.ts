import { beforeEach, describe, expect, it } from "vitest";
import { afterRemoval, loadAfterArchive, returnTo, saveAfterArchive, stepThread, threadPosition } from "./threadNavigation";

const order = ["a", "b", "c"];

describe("afterRemoval", () => {
  it("moves on to the next thread, or the previous one at the end", () => {
    expect(afterRemoval(order, "a", "next")).toBe("b");
    expect(afterRemoval(order, "c", "next")).toBe("b");
  });

  it("moves back to the previous thread, or the next one at the start", () => {
    expect(afterRemoval(order, "b", "previous")).toBe("a");
    expect(afterRemoval(order, "a", "previous")).toBe("b");
  });

  it("goes back to the board when asked to, when the card is empty, or when the thread wasn't in it", () => {
    expect(afterRemoval(order, "b", "board")).toBeNull();
    expect(afterRemoval(["a"], "a", "next")).toBeNull();
    expect(afterRemoval(order, "z", "next")).toBeNull();
  });
});

describe("threadPosition and stepThread", () => {
  it("counts from one", () => {
    expect(threadPosition(order, "b")).toEqual({ index: 2, total: 3 });
    expect(threadPosition(order, "z")).toBeNull();
  });

  it("steps within the card, stopping at its ends", () => {
    expect(stepThread(order, "b", 1)).toBe("c");
    expect(stepThread(order, "b", -1)).toBe("a");
    expect(stepThread(order, "c", 1)).toBeNull();
    expect(stepThread(order, "a", -1)).toBeNull();
    expect(stepThread(order, "z", 1)).toBeNull();
  });
});

describe("the after-archive setting", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to the next thread and remembers a choice", () => {
    expect(loadAfterArchive()).toBe("next");
    saveAfterArchive("board");
    expect(loadAfterArchive()).toBe("board");
  });

  it("ignores a stored value it doesn't know", () => {
    localStorage.setItem("afterArchive", "sideways");
    expect(loadAfterArchive()).toBe("next");
  });
});

describe("returnTo", () => {
  it("goes back to the row a view was opened from, wherever it now sits", () => {
    expect(returnTo(["x", "a", "b", "c"], { itemId: "b", index: 1 })).toBe("b");
  });

  it("takes the row now in its place once it left the card, or the last row", () => {
    expect(returnTo(["a", "c"], { itemId: "b", index: 1 })).toBe("c");
    expect(returnTo(["a"], { itemId: "b", index: 1 })).toBe("a");
    expect(returnTo([], { itemId: "b", index: 1 })).toBeNull();
  });
});
