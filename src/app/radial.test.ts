import { describe, expect, it } from "vitest";
import { autoArc, fittedRadius, layoutPetals, petalAngles } from "./radial";

describe("petalAngles", () => {
  it("spreads petals from one end of the arc to the other", () => {
    expect(petalAngles(3, { start: 240, span: -120 })).toEqual([240, 180, 120]);
    expect(petalAngles(3, { start: -60, span: 120 })).toEqual([-60, 0, 60]);
  });

  it("puts a single petal in the middle of its arc", () => {
    expect(petalAngles(1, { start: -60, span: 120 })).toEqual([0]);
  });

  it("leaves no petal doubled at the seam of a full circle", () => {
    expect(petalAngles(4, { start: 0, span: 360 })).toEqual([0, 90, 180, 270]);
  });
});

describe("layoutPetals", () => {
  it("places petals on the ring, right being 0 and down 90", () => {
    const { petals } = layoutPetals({ count: 2, arc: { start: 0, span: 90 }, radius: 40, itemSize: 20 });
    expect(petals).toEqual([{ angle: 0, x: 40, y: 0 }, { angle: 90, x: 0, y: 40 }]);
  });

  it("lets petals overlap when allowed, and grows the ring until they touch when not", () => {
    const arc = { start: 180, span: 120 };
    expect(layoutPetals({ count: 8, arc, radius: 38, itemSize: 28, overlap: "allow" }).radius).toBe(38);
    const grown = layoutPetals({ count: 8, arc, radius: 38, itemSize: 28, overlap: "grow", gap: 2, maxRadius: 200 });
    const [a, b] = grown.petals;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(30, 0);
  });

  it("never grows past the most it may", () => {
    expect(fittedRadius(9, { start: 0, span: 90 }, 20, 20, 2, 60)).toBe(60);
    expect(fittedRadius(2, { start: 0, span: 180 }, 20, 20, 2, 60)).toBe(20);
  });
});

describe("autoArc", () => {
  const anchor = { left: 90, top: 90, right: 110, bottom: 110 };

  it("opens toward the asked direction when there is room", () => {
    const bounds = { left: 0, top: 0, right: 200, bottom: 200 };
    expect(autoArc({ anchor, bounds, toward: 180, maxSpan: 120, reach: 40 })).toEqual({ start: 120, span: 120 });
  });

  it("turns away from an edge it would cross", () => {
    // The anchor hugs the left edge: a left-facing fan swings right
    const bounds = { left: 80, top: 0, right: 300, bottom: 300 };
    const arc = autoArc({ anchor, bounds, toward: 180, maxSpan: 120, reach: 40 });
    for (const deg of petalAngles(5, arc)) {
      expect(100 + 40 * Math.cos((deg * Math.PI) / 180)).toBeGreaterThanOrEqual(80);
    }
  });

  it("centres on the asked direction with nothing to measure", () => {
    expect(autoArc({ anchor: { left: 0, top: 0, right: 0, bottom: 0 }, toward: 0, maxSpan: 120, reach: 40 })).toEqual({ start: -60, span: 120 });
  });
});
