import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { ColorFlower } from "./ColorFlower";

describe("ColorFlower", () => {
  it("keeps the same petals while a hover previews colours, so the one under the pointer stays put", () => {
    const [value, setValue] = createSignal<string | null>("red");
    render(() => (
      <ColorFlower
        title="Card color"
        colors={[{ hue: "red", label: "Red" }, { hue: "blue", label: "Blue" }]}
        value={value()}
        onChange={setValue}
        onPreview={setValue}
        open
        setOpen={vi.fn()}
        toward={45}
      />
    ));
    const none = screen.getByRole("menuitemradio", { name: "No color" });
    fireEvent.pointerEnter(none);
    expect(value()).toBeNull();
    expect(screen.getByRole("menuitemradio", { name: "No color" })).toBe(none);
    expect(none).toHaveAttribute("aria-checked", "true");
    fireEvent.pointerLeave(none);
    expect(value()).toBe("red");
  });

  describe("spreading the tried colour", () => {
    const animate = vi.fn((_frames: Keyframe[], _options?: KeyframeAnimationOptions) => ({ finished: new Promise(() => {}), cancel: () => {} }));
    afterEach(() => {
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
      animate.mockClear();
    });

    function inCard() {
      (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
      const [value, setValue] = createSignal<string | null>(null);
      render(() => (
        <div class="card" data-color={value() ?? undefined}>
          <ColorFlower
            title="Card color"
            colors={[{ hue: "red", label: "Red" }, { hue: "blue", label: "Blue" }]}
            value={value()}
            onChange={setValue}
            onPreview={setValue}
            open
            setOpen={vi.fn()}
            toward={45}
          />
        </div>
      ));
      const card = document.querySelector<HTMLElement>(".card")!;
      card.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 400, right: 320, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
      const petal = screen.getByRole("menuitemradio", { name: "Blue" });
      petal.getBoundingClientRect = () => ({ left: 40, top: 10, width: 20, height: 20, right: 60, bottom: 30, x: 40, y: 10, toJSON: () => ({}) });
      return { card, petal, value };
    }

    it("spreads the colour across its card from the petal it was tried on", () => {
      const { card, petal, value } = inCard();
      fireEvent.pointerEnter(petal);
      expect(value()).toBe("blue");
      expect(card.querySelectorAll(".color-spread")).toHaveLength(2);
      const grow = animate.mock.calls.find(([frames]) => "clipPath" in frames[0])!;
      expect(grow[0][0]).toEqual({ clipPath: "circle(0px at 50px 20px)" });
    });

    it("puts the colour it started from back at once when the try ends", () => {
      const { card, petal, value } = inCard();
      fireEvent.pointerEnter(petal);
      animate.mockClear();
      fireEvent.pointerLeave(petal);
      expect(value()).toBeNull();
      expect(animate).not.toHaveBeenCalled();
      expect(card.querySelectorAll(".color-spread")).toHaveLength(0);
    });
  });
});
