import { describe, expect, it } from "vitest";
import { placeBelowAnchor } from "./popoverPlacement";

const viewport = { width: 1440, height: 900 };
const size = { width: 320, height: 360 };
const anchor = (left: number, top: number) => ({ left, top, right: left + 22, bottom: top + 22 });

describe("placeBelowAnchor", () => {
  it("opens under the anchor, aligned to its left edge", () => {
    expect(placeBelowAnchor(anchor(100, 100), size, viewport)).toEqual({ top: 130, left: 100 });
  });

  it("shifts left to stay inside the window", () => {
    expect(placeBelowAnchor(anchor(1300, 100), size, viewport).left).toBe(1440 - 320 - 8);
  });

  it("opens above the anchor when there is no room below", () => {
    expect(placeBelowAnchor(anchor(100, 700), size, viewport).top).toBe(700 - 8 - 360);
  });

  it("keeps the top edge on screen when there is no room either way", () => {
    expect(placeBelowAnchor(anchor(100, 300), size, { width: 1440, height: 500 }).top).toBe(8);
  });
});
