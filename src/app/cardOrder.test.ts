import { describe, expect, it } from "vitest";
import { moveCard, reuseUnchanged } from "./cardOrder";

const a = { id: "a", name: "A", query: "q" };
const b = { id: "b", name: "B", query: "q" };
const c = { id: "c", name: "C", query: "q" };

describe("moveCard", () => {
  it("moves the dragged card to the drop target's place, keeping every card object", () => {
    const moved = moveCard([a, b, c], "a", "c")!;
    expect(moved.map(x => x.id)).toEqual(["b", "c", "a"]);
    expect(moved[2]).toBe(a);
    expect(moved[0]).toBe(b);
    expect(moveCard([a, b, c], "c", "a")!.map(x => x.id)).toEqual(["c", "a", "b"]);
  });

  it("is null when nothing moves", () => {
    expect(moveCard([a, b], "a", "a")).toBeNull();
    expect(moveCard([a, b], "a", "missing")).toBeNull();
  });
});

describe("reuseUnchanged", () => {
  it("keeps the previous object for a card whose fields are the same", () => {
    const next = [{ ...b }, { ...a, name: "Renamed" }, { ...c }];
    const merged = reuseUnchanged([a, b, c], next);
    expect(merged[0]).toBe(b);
    expect(merged[1]).toBe(next[1]);
    expect(merged[2]).toBe(c);
  });

  it("takes new cards and cards with added fields as they come", () => {
    const d = { id: "d", name: "D", query: "q" };
    const merged = reuseUnchanged<{ id: string; name: string; query: string; color?: string }>([a], [{ ...a, color: "red" }, d]);
    expect(merged[0]).not.toBe(a);
    expect(merged[1]).toBe(d);
  });
});
