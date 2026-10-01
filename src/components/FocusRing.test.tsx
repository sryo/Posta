import { afterEach, describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { FocusRing } from "./FocusRing";

const originalMatchMedia = window.matchMedia;
afterEach(() => { window.matchMedia = originalMatchMedia; });

function placed(el: HTMLElement, box: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => ({}) });
  return el;
}

function list() {
  const body = placed(document.createElement("div"), { left: 0, top: 0, width: 300, height: 400 });
  body.className = "card-body";
  document.body.append(body);
  const row = (top: number) => {
    const el = placed(document.createElement("div"), { left: 10, top, width: 280, height: 50 });
    body.append(el);
    return el;
  };
  return { body, row };
}

const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));
const ring = () => document.querySelector<HTMLElement>(".focus-ring")!;

describe("FocusRing", () => {
  it("sits over the focused row in its card's colour", async () => {
    const { row } = list();
    const first = row(20);
    render(() => <FocusRing target={() => first} hue="green" bump={null} />);
    await frame();
    expect(ring()).toHaveAttribute("data-hue", "green");
    expect(ring()).toHaveAttribute("aria-hidden", "true");
    expect(ring().style.transform).toBe("translate(10px, 20px)");
    expect(ring().style.width).toBe("280px");
    expect(ring().style.height).toBe("50px");
  });

  it("glides to the next row, and follows a row that moves under it without gliding", async () => {
    const { row } = list();
    const first = row(20);
    const second = row(70);
    const [target, setTarget] = createSignal<HTMLElement>(first);
    render(() => <FocusRing target={target} bump={null} />);
    await frame();
    expect(ring()).toHaveClass("instant");

    setTarget(second);
    await frame();
    expect(ring().style.transform).toBe("translate(10px, 70px)");
    expect(ring()).not.toHaveClass("instant");

    placed(second, { left: 10, top: 40, width: 280, height: 50 });
    await frame();
    await frame();
    expect(ring().style.transform).toBe("translate(10px, 40px)");
    expect(ring()).toHaveClass("instant");
  });

  it("jumps instead of gliding when motion is reduced", async () => {
    window.matchMedia = ((query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" })) as unknown as typeof window.matchMedia;
    const { row } = list();
    const first = row(20);
    const second = row(70);
    const [target, setTarget] = createSignal<HTMLElement>(first);
    render(() => <FocusRing target={target} bump={null} />);
    await frame();
    setTarget(second);
    await frame();
    expect(ring()).toHaveClass("instant");
  });

  it("draws nothing while no row is focused", async () => {
    const { row } = list();
    const first = row(20);
    const [target, setTarget] = createSignal<HTMLElement | null>(first);
    render(() => <FocusRing target={target} bump={null} />);
    await frame();
    setTarget(null);
    await frame();
    expect(ring().style.width).toBe("0px");
    expect(ring().style.height).toBe("0px");
  });

  it("nudges toward the edge it was pressed against", async () => {
    const { row } = list();
    const first = row(20);
    const [bump, setBump] = createSignal<{ toward: "down" | "up" | "side"; at: number } | null>(null);
    render(() => <FocusRing target={() => first} bump={bump()} />);
    await frame();
    setBump({ toward: "down", at: 1 });
    expect(ring()).toHaveAttribute("data-bump", "down");
  });
});
