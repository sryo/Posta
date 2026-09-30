import { describe, expect, it, vi } from "vitest";
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
});
