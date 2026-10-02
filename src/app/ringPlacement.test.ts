import { describe, expect, it } from "vitest";
import { ringPlacement } from "./ringPlacement";

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });

describe("ringPlacement", () => {
  it("sits on the row, cutting nothing while the row is in full view", () => {
    expect(ringPlacement(rect(100, 200, 300, 60), rect(100, 150, 300, 500))).toEqual({
      x: 100, y: 200, width: 300, height: 60, clip: "inset(0px 0px 0px 0px)",
    });
  });

  it("cuts the part of the row scrolled out of its list", () => {
    expect(ringPlacement(rect(100, 130, 300, 60), rect(100, 150, 300, 500)).clip).toBe("inset(20px 0px 0px 0px)");
    expect(ringPlacement(rect(100, 620, 300, 60), rect(100, 150, 300, 500)).clip).toBe("inset(0px 0px 30px 0px)");
  });

  it("cuts it all away when the row is out of sight", () => {
    expect(ringPlacement(rect(100, 700, 300, 60), rect(100, 150, 300, 500)).clip).toBe("inset(0px 0px 60px 0px)");
  });
});
