import { describe, expect, it } from "vitest";
import { bulkActionForKey, extendSelection, keyTargets } from "./bulkKeys";

describe("keyTargets", () => {
  it("acts on the selection when there is one, else on the focused row", () => {
    expect(keyTargets(new Set(["b", "c"]), "a")).toEqual(["b", "c"]);
    expect(keyTargets(new Set(), "a")).toEqual(["a"]);
    expect(keyTargets(undefined, "a")).toEqual(["a"]);
    expect(keyTargets(undefined, null)).toEqual([]);
  });
});

describe("bulkActionForKey", () => {
  it("does what the bulk wheel's buttons with the same key hints do", () => {
    expect(bulkActionForKey("a")).toBe("archive");
    expect(bulkActionForKey("s")).toBe("star");
    expect(bulkActionForKey("u")).toBe("read");
    expect(bulkActionForKey("i")).toBe("important");
    expect(bulkActionForKey("d")).toBe("trash");
    expect(bulkActionForKey("#")).toBe("trash");
    expect(bulkActionForKey("!")).toBe("spam");
    expect(bulkActionForKey("f")).toBeNull();
  });
});

describe("extendSelection", () => {
  const ids = ["a", "b", "c"];

  it("selects the focused row and the next one, moving focus there", () => {
    expect(extendSelection(ids, new Set(), 0, true)).toEqual({ selected: new Set(["a", "b"]), index: 1 });
    expect(extendSelection(ids, new Set(["a", "b"]), 1, true)).toEqual({ selected: new Set(["a", "b", "c"]), index: 2 });
  });

  it("extends upwards too", () => {
    expect(extendSelection(ids, new Set(), 2, false)).toEqual({ selected: new Set(["b", "c"]), index: 1 });
  });

  it("selects the focused row alone at either end", () => {
    expect(extendSelection(ids, new Set(), 2, true)).toEqual({ selected: new Set(["c"]), index: 2 });
    expect(extendSelection(ids, new Set(), 0, false)).toEqual({ selected: new Set(["a"]), index: 0 });
  });

  it("leaves everything as it is without a focused row", () => {
    expect(extendSelection(ids, new Set(["b"]), -1, true)).toEqual({ selected: new Set(["b"]), index: -1 });
  });
});
