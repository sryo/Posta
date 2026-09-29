import { describe, expect, it } from "vitest";
import { nextSelection } from "./selection";

const ids = ["a", "b", "c", "d", "e"];

describe("nextSelection", () => {
  it("toggles the clicked item and makes it the range pivot when it is added", () => {
    expect(nextSelection(ids, new Set(), null, "b", false)).toEqual({ selected: new Set(["b"]), pivot: "b" });
    expect(nextSelection(ids, new Set(["b"]), "b", "b", false)).toEqual({ selected: new Set(), pivot: "b" });
  });

  it("adds the range from the pivot with shift, forwards and backwards, keeping the pivot", () => {
    expect(nextSelection(ids, new Set(["b"]), "b", "d", true)).toEqual({ selected: new Set(["b", "c", "d"]), pivot: "b" });
    expect(nextSelection(ids, new Set(["d"]), "d", "a", true)).toEqual({ selected: new Set(["a", "b", "c", "d"]), pivot: "d" });
  });

  it("toggles like a plain click when the pivot is gone or there is none", () => {
    expect(nextSelection(ids, new Set(), "gone", "c", true)).toEqual({ selected: new Set(["c"]), pivot: "c" });
    expect(nextSelection(ids, new Set(), null, "c", true)).toEqual({ selected: new Set(["c"]), pivot: "c" });
  });

  it("leaves the given set unchanged", () => {
    const before = new Set(["a"]);
    nextSelection(ids, before, "a", "c", true);
    expect(before).toEqual(new Set(["a"]));
  });
});
