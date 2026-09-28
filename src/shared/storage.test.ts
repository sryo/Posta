import { afterEach, describe, expect, it, vi } from "vitest";
import { safeGetJSON, safeSetItem, safeSetJSON } from "./storage";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("safe localStorage writes", () => {
  it("report whether the value was stored", () => {
    expect(safeSetItem("k", "v")).toBe(true);
    expect(safeSetJSON("j", { a: 1 })).toBe(true);
    expect(safeGetJSON("j", null)).toEqual({ a: 1 });
  });

  it("report a write the browser refused, such as a full quota", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(safeSetItem("k", "v")).toBe(false);
    expect(safeSetJSON("j", { a: 1 })).toBe(false);
  });

  it("report a value that can't be serialised instead of throwing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(safeSetJSON("j", cyclic)).toBe(false);
  });
});
