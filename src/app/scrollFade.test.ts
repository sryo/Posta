import { describe, expect, it } from "vitest";
import { watchScrollFade } from "./scrollFade";

const frame = () => new Promise(r => requestAnimationFrame(r));

function box(sizes: { scrollHeight: number; clientHeight: number }) {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { get: () => sizes.scrollHeight });
  Object.defineProperty(el, "clientHeight", { get: () => sizes.clientHeight });
  document.body.appendChild(el);
  return el;
}

describe("watchScrollFade", () => {
  it("marks a box with more below its edge, and clears it at the end", async () => {
    const el = box({ scrollHeight: 500, clientHeight: 200 });
    const stop = watchScrollFade(el);
    await frame();
    expect(el).toHaveClass("more-below");
    el.scrollTop = 300;
    el.dispatchEvent(new Event("scroll"));
    await frame();
    expect(el).not.toHaveClass("more-below");
    stop();
  });

  it("leaves a box that fits alone", async () => {
    const el = box({ scrollHeight: 200, clientHeight: 200 });
    const stop = watchScrollFade(el);
    await frame();
    expect(el).not.toHaveClass("more-below");
    stop();
  });
});
