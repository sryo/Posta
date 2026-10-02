import { afterEach, describe, expect, it } from "vitest";
import { EASE_EXIT, EASE_SETTLE, reducedMotion, settled } from "./motion";

const original = window.matchMedia;
afterEach(() => { window.matchMedia = original; });
const prefer = (reduce: boolean) => {
  window.matchMedia = ((query: string) => ({ matches: reduce && query === "(prefers-reduced-motion: reduce)" })) as unknown as typeof window.matchMedia;
};

describe("reducedMotion", () => {
  it("asks the system each time, since the setting can change while the app runs", () => {
    prefer(true);
    expect(reducedMotion()).toBe(true);
    prefer(false);
    expect(reducedMotion()).toBe(false);
  });

  it("moves when the window can't say", () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(reducedMotion()).toBe(false);
  });

  it("settles on the curve the stylesheet's own settling motion uses", () => {
    expect(EASE_SETTLE).toBe("cubic-bezier(0.2, 0.8, 0.2, 1)");
  });
});

describe("EASE_EXIT", () => {
  it("leaves on the radial menus' exit curve", () => {
    expect(EASE_EXIT).toBe("cubic-bezier(0.4, 0, 1, 1)");
  });
});

describe("settled", () => {
  it("resolves when an animation is cancelled as well as when it finishes", async () => {
    const cancelled = { finished: Promise.reject(new DOMException("cancelled", "AbortError")) } as unknown as Animation;
    const finished = { finished: Promise.resolve() } as unknown as Animation;
    await expect(settled(cancelled)).resolves.toBeUndefined();
    await expect(settled(finished)).resolves.toBeUndefined();
    await expect(settled(undefined)).resolves.toBeUndefined();
  });
});
