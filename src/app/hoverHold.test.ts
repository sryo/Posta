import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@solidjs/testing-library";
import { createHoverHold } from "./hoverHold";

const rect = (left: number, top: number, size: number) => () =>
  ({ left, top, right: left + size, bottom: top + size, width: size, height: size, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

// A wheel anchored at (100, 100) with one 28px petal centred 38 to its right
function wheel() {
  const menu = document.createElement("div");
  menu.className = "radial-menu open";
  menu.getBoundingClientRect = rect(100, 100, 0);
  const petal = document.createElement("button");
  petal.className = "radial-petal";
  petal.getBoundingClientRect = rect(124, 86, 28);
  menu.append(petal);
  document.body.append(menu);
  return menu;
}

const move = (x: number, y: number) => fireEvent.pointerMove(document, { clientX: x, clientY: y });

describe("createHoverHold", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("keeps a wheel while the pointer rests near it, and lets it go once it moves away", () => {
    const hold = createHoverHold();
    const exit = vi.fn();
    expect(hold.hold(wheel(), 138 + 14 + 8, 100, exit)).toBe(true);
    move(138, 100 + 14 + 18);
    expect(exit).not.toHaveBeenCalled();
    move(138, 100 + 14 + 30);
    expect(exit).toHaveBeenCalledOnce();
  });

  it("holds nothing when the pointer left far from the wheel", () => {
    const hold = createHoverHold();
    expect(hold.hold(wheel(), 300, 300, vi.fn())).toBe(false);
    expect(hold.hold(null, 138, 100, vi.fn())).toBe(false);
  });

  it("makes a row entered near the wheel wait, and gives it the wheel once the pointer moves away", () => {
    const hold = createHoverHold();
    const exit = vi.fn();
    const run = vi.fn();
    hold.hold(wheel(), 160, 100, exit);
    expect(hold.wait("b", 138, 120, run)).toBe(true);
    move(138, 200);
    expect(run).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
  });

  it("forgets a waiting row the pointer left, closing the wheel instead", () => {
    const hold = createHoverHold();
    const exit = vi.fn();
    const run = vi.fn();
    hold.hold(wheel(), 160, 100, exit);
    hold.wait("b", 138, 120, run);
    expect(hold.leave("b")).toBe(true);
    move(138, 200);
    expect(run).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledOnce();
  });

  it("lets a row entered away from the wheel take it at once", () => {
    const hold = createHoverHold();
    hold.hold(wheel(), 160, 100, vi.fn());
    expect(hold.wait("b", 400, 400, vi.fn())).toBe(false);
  });

  it("stops watching once released", () => {
    const hold = createHoverHold();
    const exit = vi.fn();
    hold.hold(wheel(), 160, 100, exit);
    hold.release();
    move(500, 500);
    expect(exit).not.toHaveBeenCalled();
    expect(hold.leave("a")).toBe(false);
  });
});
