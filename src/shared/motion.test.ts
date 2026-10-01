import { afterEach, describe, expect, it, vi } from "vitest";
import { EASE_OUT, fold, insetClip, morphHeight, play, reducedMotion } from "./motion";

const original = window.matchMedia;
afterEach(() => { window.matchMedia = original; });
const stubMotion = (reduce: boolean) => {
  window.matchMedia = ((query: string) => ({ matches: reduce && query === "(prefers-reduced-motion: reduce)" })) as unknown as typeof window.matchMedia;
};

describe("reducedMotion", () => {
  it("is off unless the system asks for less motion", () => {
    stubMotion(false);
    expect(reducedMotion()).toBe(false);
    stubMotion(true);
    expect(reducedMotion()).toBe(true);
  });
});

describe("insetClip", () => {
  const box = { top: 0, left: 0, right: 1000, bottom: 800 };

  it("clips a box down to a rect inside it", () => {
    expect(insetClip({ top: 100, left: 20, right: 320, bottom: 160 }, box, 8)).toBe("inset(100px 680px 640px 20px round 8px)");
  });

  it("shows the whole box for the box itself", () => {
    expect(insetClip(box, box)).toBe("inset(0px 0px 0px 0px round 0px)");
  });
});

describe("play", () => {
  it("plays the motion, or the reduced one instead when motion is reduced", () => {
    const el = document.createElement("div");
    const animate = vi.fn(() => ({}) as Animation);
    el.animate = animate;
    stubMotion(false);
    play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 }, [{ opacity: 0.5 }]);
    expect(animate).toHaveBeenLastCalledWith([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    stubMotion(true);
    play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 }, [{ opacity: 0.5 }], 120);
    expect(animate).toHaveBeenLastCalledWith([{ opacity: 0.5 }], { duration: 120 });
  });

  it("plays nothing under reduced motion without a reduced version, or where animation is missing", () => {
    const el = document.createElement("div");
    const animate = vi.fn(() => ({}) as Animation);
    el.animate = animate;
    stubMotion(true);
    expect(play(el, [{ opacity: 0 }], { duration: 300 })).toBeNull();
    expect(animate).not.toHaveBeenCalled();
    stubMotion(false);
    expect(play(document.createElement("div"), [{ opacity: 0 }], { duration: 300 })).toBeNull();
  });
});

describe("fold", () => {
  it("folds a part away out of reach, and opens it again", () => {
    stubMotion(false);
    const el = document.createElement("div");
    fold(el, false);
    expect(el).toHaveAttribute("data-folded");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.inert).toBe(true);
    fold(el, true);
    expect(el).not.toHaveAttribute("data-folded");
    expect(el).not.toHaveAttribute("aria-hidden");
    expect(el.inert).toBe(false);
  });

  it("closes from its height to none, and swaps at once under reduced motion", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ height: el.hasAttribute("data-folded") ? 0 : 40 }) as DOMRect;
    const animate = vi.fn(() => ({}) as Animation);
    el.animate = animate;
    stubMotion(false);
    fold(el, false);
    expect(animate).toHaveBeenCalledTimes(1);
    const [[keyframes, options]] = animate.mock.calls as unknown as [Keyframe[], KeyframeAnimationOptions][];
    expect(keyframes[0]).toMatchObject({ height: "40px", opacity: 1 });
    expect(keyframes[1]).toMatchObject({ height: "0px", opacity: 0 });
    expect(options).toMatchObject({ duration: 240, easing: EASE_OUT });
    stubMotion(true);
    fold(el, true);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(el).not.toHaveAttribute("data-folded");
  });
});

describe("morphHeight", () => {
  it("eases an element from its old height to the one a change gives it", () => {
    stubMotion(false);
    const el = document.createElement("div");
    let height = 150;
    el.getBoundingClientRect = () => ({ height }) as DOMRect;
    const animate = vi.fn(() => ({}) as Animation);
    el.animate = animate;
    morphHeight(el, () => { height = 40; });
    expect(animate).toHaveBeenCalledWith([{ height: "150px" }, { height: "40px" }], expect.objectContaining({ duration: 240, easing: EASE_OUT }));
  });
});
