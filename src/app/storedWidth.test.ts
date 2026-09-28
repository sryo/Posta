import { describe, expect, it } from "vitest";
import { parseStoredWidth } from "./storedWidth";

describe("parseStoredWidth", () => {
  it("uses the stored value when it is in range", () => {
    expect(parseStoredWidth("420", 320, 250, 600)).toBe(420);
  });

  it("clamps out-of-range values", () => {
    expect(parseStoredWidth("9000", 320, 250, 600)).toBe(600);
    expect(parseStoredWidth("10", 320, 250, 600)).toBe(250);
  });

  it("falls back to the default when nothing or garbage is stored", () => {
    expect(parseStoredWidth(null, 320, 250, 600)).toBe(320);
    expect(parseStoredWidth("wide", 320, 250, 600)).toBe(320);
    expect(parseStoredWidth("", 320, 250, 600)).toBe(320);
  });
});
