import { describe, expect, it } from "vitest";
import { autoArc, fittedRadius, layoutPetals, nearWheel, petalAngles } from "./radial";

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
    expect(autoArc({ anchor, bounds, toward: 180, maxSpan: 120, radius: 40, itemSize: 20 })).toEqual({ start: 120, span: 120 });
  });

  it("keeps every petal's whole box inside, turning away from an edge it would cross", () => {
    // The anchor sits near the top-left corner: a fan toward down-right can't reach up or left
    const bounds = { left: 70, top: 76, right: 400, bottom: 400 };
    const arc = autoArc({ anchor, bounds, toward: 45, maxSpan: 240, radius: 40, itemSize: 18 });
    expect(arc.span).toBeLessThan(240);
    for (const deg of petalAngles(9, arc)) {
      const x = 100 + 40 * Math.cos((deg * Math.PI) / 180);
      const y = 100 + 40 * Math.sin((deg * Math.PI) / 180);
      expect(x - 9).toBeGreaterThanOrEqual(70);
      expect(y - 9).toBeGreaterThanOrEqual(76);
    }
  });

  it("centres on the asked direction with nothing to measure", () => {
    expect(autoArc({ anchor: { left: 0, top: 0, right: 0, bottom: 0 }, toward: 0, maxSpan: 120, radius: 40, itemSize: 20 })).toEqual({ start: -60, span: 120 });
  });

  it("never closes below its narrowest arc, where petals would hide one another", () => {
    // A row at a card's bottom corner: barely any room anywhere
    const bounds = { left: 60, top: 80, right: 140, bottom: 115 };
    const arc = autoArc({ anchor, bounds, toward: 180, maxSpan: 120, minSpan: 90, radius: 38, itemSize: 28 });
    expect(Math.abs(arc.span)).toBeGreaterThanOrEqual(90);
  });
});

describe("nearWheel", () => {
  // A right-hand fan: petals of radius 14 at 38 from the anchor, up, right and down
  const anchor = { x: 0, y: 0 };
  const fan = [{ x: 0, y: -38, r: 14 }, { x: 38, y: 0, r: 14 }, { x: 0, y: 38, r: 14 }];

  it("holds just past a petal's edge, and not beyond the pad", () => {
    expect(nearWheel(anchor, fan, { x: 38 + 14 + 11, y: 0 }, 12)).toBe(true);
    expect(nearWheel(anchor, fan, { x: 38 + 14 + 13, y: 0 }, 12)).toBe(false);
  });

  it("holds on the way out from the anchor to a petal", () => {
    expect(nearWheel(anchor, fan, { x: 19, y: 0 }, 12)).toBe(true);
  });

  it("holds in the wedge between two neighbouring petals", () => {
    expect(nearWheel(anchor, fan, { x: 16, y: -16 }, 0)).toBe(true);
  });

  it("does not hold on the fan's open side", () => {
    expect(nearWheel(anchor, fan, { x: -30, y: 0 }, 12)).toBe(false);
  });

  it("holds all round a full ring, the seam included", () => {
    const ring = petalAngles(8, { start: -90, span: 360 }).map(a => ({ x: 44 * Math.cos((a * Math.PI) / 180), y: 44 * Math.sin((a * Math.PI) / 180), r: 16 }));
    for (let a = 0; a < 360; a += 15) {
      const p = { x: 30 * Math.cos((a * Math.PI) / 180), y: 30 * Math.sin((a * Math.PI) / 180) };
      expect(nearWheel(anchor, ring, p, 0), `${a}°`).toBe(true);
    }
  });
});
