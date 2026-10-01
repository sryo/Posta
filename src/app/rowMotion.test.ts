import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { measureRows, slideRows } from "./rowMotion";
import { EASE_SETTLE } from "./motion";

type Call = { el: Element; frames: Keyframe[]; options: KeyframeAnimationOptions };
let calls: Call[] = [];
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  calls = [];
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
    calls.push({ el: this, frames, options });
    return { finished: Promise.resolve(), cancel: () => {} };
  };
});
afterEach(() => {
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  window.matchMedia = originalMatchMedia;
  document.body.innerHTML = "";
});

// A list whose rows sit where `tops` says, 50px high, in a list 400px high
function list(tops: Record<string, number>) {
  const body = document.createElement("div");
  body.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 400, right: 300, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
  document.body.append(body);
  const place = (next: Record<string, number>) => {
    body.innerHTML = "";
    for (const [id, top] of Object.entries(next)) {
      const row = document.createElement("div");
      row.className = "thread";
      row.dataset.threadId = id;
      Object.defineProperty(row, "offsetHeight", { value: 50 });
      row.getBoundingClientRect = () => ({ left: 0, top: top - body.scrollTop, width: 300, height: 50, right: 300, bottom: top - body.scrollTop + 50, x: 0, y: top - body.scrollTop, toJSON: () => ({}) });
      body.append(row);
    }
  };
  place(tops);
  return { body, place };
}
const rowOf = (body: Element, id: string) => body.querySelector(`[data-thread-id="${id}"]`)!;

describe("slideRows", () => {
  it("slides the rows already there from where they were", () => {
    const { body, place } = list({ a: 0, b: 50 });
    const before = measureRows(body);
    place({ n: 0, a: 50, b: 100 });
    slideRows(body, before, { entering: new Set(["n"]) });

    const slide = calls.find(c => c.el === rowOf(body, "a"))!;
    expect(slide.frames).toEqual([{ transform: "translateY(-50px)" }, { transform: "none" }]);
    expect(slide.options).toMatchObject({ duration: 260, easing: EASE_SETTLE });
  });

  it("grows the new rows in, a little apart", () => {
    const { body, place } = list({ a: 0 });
    const before = measureRows(body);
    place({ n1: 0, n2: 50, a: 100 });
    slideRows(body, before, { entering: new Set(["n1", "n2"]) });

    const grow = (id: string) => calls.find(c => c.el === rowOf(body, id))!;
    expect(grow("n1").frames).toEqual([
      expect.objectContaining({ height: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: 0 }),
      expect.objectContaining({ height: "50px", opacity: 1 }),
    ]);
    expect((rowOf(body, "n1") as HTMLElement).style.overflow).toBe("hidden");
    expect(grow("n1").options).toMatchObject({ duration: 240, delay: 0, easing: EASE_SETTLE, fill: "backwards" });
    expect(grow("n2").options).toMatchObject({ delay: 30 });
  });

  it("lets a grown row's content out again once it is in", async () => {
    const { body, place } = list({ a: 0 });
    const before = measureRows(body);
    place({ n1: 0, a: 50 });
    slideRows(body, before, { entering: new Set(["n1"]) });
    await new Promise(r => setTimeout(r, 0));
    expect((rowOf(body, "n1") as HTMLElement).style.overflow).toBe("");
  });

  it("leaves a row that didn't move alone", () => {
    const { body, place } = list({ a: 0, b: 50 });
    const before = measureRows(body);
    place({ a: 0, b: 50 });
    slideRows(body, before, { entering: new Set() });
    expect(calls).toHaveLength(0);
  });

  it("moves nothing when motion is reduced", () => {
    window.matchMedia = ((query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" })) as unknown as typeof window.matchMedia;
    const { body, place } = list({ a: 0 });
    const before = measureRows(body);
    place({ n: 0, a: 50 });
    slideRows(body, before, { entering: new Set(["n"]) });
    expect(calls).toHaveLength(0);
  });

  it("adds rows above a list scrolled down without moving what is in view", () => {
    const { body, place } = list({ a: 0, b: 50, c: 100, d: 150 });
    body.scrollTop = 60;
    const before = measureRows(body);
    place({ n1: 0, n2: 50, a: 100, b: 150, c: 200, d: 250 });
    slideRows(body, before, { entering: new Set(["n1", "n2"]) });
    expect(body.scrollTop).toBe(160);
    expect(calls).toHaveLength(0);
  });
});
