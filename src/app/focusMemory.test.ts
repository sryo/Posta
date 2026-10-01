import { describe, expect, it } from "vitest";
import { createFocusMemory } from "./focusMemory";

describe("createFocusMemory", () => {
  it("starts a card it has never seen at its first row", () => {
    const memory = createFocusMemory();
    expect(memory.recall("inbox", ["t1", "t2"])).toBe(0);
  });

  it("returns to the row last left in each card", () => {
    const memory = createFocusMemory();
    memory.remember("inbox", "t3", 2);
    memory.remember("receipts", "r1", 0);
    expect(memory.recall("inbox", ["t1", "t2", "t3"])).toBe(2);
    expect(memory.recall("receipts", ["r0", "r1"])).toBe(1);
  });

  it("follows the remembered thread when rows above it came or went", () => {
    const memory = createFocusMemory();
    memory.remember("inbox", "t3", 2);
    expect(memory.recall("inbox", ["new", "t1", "t2", "t3"])).toBe(3);
  });

  it("takes the row now in its place when the remembered one left the card", () => {
    const memory = createFocusMemory();
    memory.remember("inbox", "t3", 2);
    expect(memory.recall("inbox", ["t1", "t2", "t4"])).toBe(2);
    expect(memory.recall("inbox", ["t1"])).toBe(0);
  });

  it("focuses the card itself when it has no rows", () => {
    const memory = createFocusMemory();
    memory.remember("inbox", "t3", 2);
    expect(memory.recall("inbox", [])).toBe(-1);
  });

  it("forgets a card", () => {
    const memory = createFocusMemory();
    memory.remember("inbox", "t3", 2);
    memory.forget("inbox");
    expect(memory.recall("inbox", ["t1", "t2", "t3"])).toBe(0);
  });
});
