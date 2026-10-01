import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spreadColor } from "./colorSpread";
import { EASE_SETTLE } from "./motion";

type Call = { el: Element; frames: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void; cancelled: boolean };
let calls: Call[] = [];
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  calls = [];
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
    let finish!: () => void;
    let fail!: (e: unknown) => void;
    const finished = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const call: Call = { el: this, frames, options, finish, cancelled: false };
    calls.push(call);
    return { finished, cancel: () => { call.cancelled = true; fail(new DOMException("cancelled", "AbortError")); } };
  };
});

afterEach(() => {
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  window.matchMedia = originalMatchMedia;
  document.body.innerHTML = "";
});

function host(width = 300, height = 200) {
  const el = document.createElement("div");
  el.style.boxShadow = "0 0 0 3px rgb(200, 200, 200)";
  el.getBoundingClientRect = () => ({ left: 100, top: 50, width, height, right: 100 + width, bottom: 50 + height, x: 100, y: 50, toJSON: () => ({}) });
  document.body.append(el);
  return el;
}
const ringTo = (el: HTMLElement, ring: string) => () => { el.style.boxShadow = ring; };
const layers = (el: Element) => Array.from(el.querySelectorAll<HTMLElement>(".color-spread"));
const settle = () => new Promise(r => setTimeout(r, 0));

describe("spreadColor", () => {
  it("grows the new colour from the point it was chosen at to the host's farthest corner, over the old one", () => {
    const card = host();
    const apply = vi.fn();
    spreadColor(card, { x: 130, y: 70 }, apply, { duration: 340, was: null, now: "red" });

    expect(apply).toHaveBeenCalledOnce();
    const [old, fresh] = layers(card);
    expect(old).not.toHaveAttribute("data-hue");
    expect(fresh).toHaveAttribute("data-hue", "red");
    expect(fresh).toHaveAttribute("aria-hidden", "true");

    const grow = calls.find(c => c.el === fresh)!;
    const farthest = Math.round(Math.hypot(300 - 30, 200 - 20));
    expect(grow.frames).toEqual([
      { clipPath: "circle(0px at 30px 20px)" },
      { clipPath: `circle(${farthest}px at 30px 20px)` },
    ]);
    expect(grow.options).toMatchObject({ duration: 340, easing: EASE_SETTLE });
    expect(card).toHaveClass("color-spreading");
  });

  it("crossfades the host's ring along with it", () => {
    const card = host();
    spreadColor(card, { x: 130, y: 70 }, ringTo(card, "0 0 0 3px rgb(255, 100, 100)"), { duration: 340, was: null, now: "red" });
    const ring = calls.find(c => c.el === card)!;
    expect(ring.frames).toEqual([{ boxShadow: "0 0 0 3px rgb(200, 200, 200)" }, { boxShadow: "0 0 0 3px rgb(255, 100, 100)" }]);
    expect(ring.options).toMatchObject({ duration: 340, easing: EASE_SETTLE });
  });

  it("leaves nothing behind once the colour has spread", async () => {
    const card = host();
    spreadColor(card, { x: 130, y: 70 }, () => {}, { duration: 340, was: null, now: "red" });
    calls.forEach(c => c.finish());
    await settle();
    expect(layers(card)).toHaveLength(0);
    expect(card).not.toHaveClass("color-spreading");
  });

  it("starts again from the next point when another colour comes before it ends", async () => {
    const card = host();
    spreadColor(card, { x: 130, y: 70 }, () => {}, { duration: 340, was: null, now: "red" });
    const first = layers(card);
    spreadColor(card, { x: 300, y: 70 }, () => {}, { duration: 340, was: "red", now: "blue" });
    await settle();
    for (const layer of first) expect(layer.isConnected).toBe(false);
    const [old, fresh] = layers(card);
    expect(old).toHaveAttribute("data-hue", "red");
    expect(fresh).toHaveAttribute("data-hue", "blue");
    expect(card).toHaveClass("color-spreading");
  });

  it("just changes when there is no point to spread from, as when colours sync", () => {
    const card = host();
    const apply = vi.fn();
    spreadColor(card, null, apply, { duration: 340, was: null, now: "red" });
    expect(apply).toHaveBeenCalledOnce();
    expect(layers(card)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("does nothing more when the colour stays the same", () => {
    const card = host();
    spreadColor(card, { x: 130, y: 70 }, () => {}, { duration: 340, was: "red", now: "red" });
    expect(layers(card)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("fades the old colour out in 150ms in place when motion is reduced", () => {
    window.matchMedia = ((query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" })) as unknown as typeof window.matchMedia;
    const card = host();
    spreadColor(card, { x: 130, y: 70 }, () => {}, { duration: 340, was: "blue", now: "red" });
    const [old] = layers(card);
    expect(layers(card)).toHaveLength(1);
    expect(old).toHaveAttribute("data-hue", "blue");
    const fade = calls.find(c => c.el === old)!;
    expect(fade.frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(fade.options).toMatchObject({ duration: 150 });
  });

  it("covers the window from where it was chosen when the host is the board", () => {
    const deck = host(1200, 800);
    spreadColor(deck, { x: 600, y: 300 }, () => {}, { duration: 460, was: null, now: "green", board: true });
    const [old, fresh] = layers(deck);
    expect(old).toHaveClass("board");
    expect(fresh).toHaveClass("board");
    const grow = calls.find(c => c.el === fresh)!;
    expect(grow.frames[0]).toEqual({ clipPath: "circle(0px at 600px 300px)" });
    expect(grow.options).toMatchObject({ duration: 460 });
  });

  it("changes without motion where the Web Animations API is missing", () => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    const card = host();
    const apply = vi.fn();
    spreadColor(card, { x: 130, y: 70 }, apply, { duration: 340, was: null, now: "red" });
    expect(apply).toHaveBeenCalledOnce();
    expect(layers(card)).toHaveLength(0);
  });
});
