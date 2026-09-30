import { describe, expect, it, vi } from "vitest";
import { createSignal, Show } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { Menu } from "./Menu";

function setup(extra: Partial<Parameters<typeof Menu>[0]> = {}) {
  const onClose = vi.fn();
  const [open, setOpen] = createSignal(false);
  render(() => (
    <>
      <button onClick={() => setOpen(true)}>Opener</button>
      <button>Elsewhere</button>
      <Show when={open()}>
        <Menu label="Pick" title="Pick one" onClose={() => { onClose(); setOpen(false); }} {...extra}>
          <button role="menuitem">One</button>
          <button role="menuitem">Two</button>
          <button role="menuitem">Three</button>
        </Menu>
      </Show>
    </>
  ));
  const opener = screen.getByRole("button", { name: "Opener" });
  opener.focus();
  fireEvent.click(opener);
  return { onClose, opener, item: (name: string) => screen.getByRole("menuitem", { name }) };
}

describe("Menu", () => {
  it("opens titled and focused on its first item, the arrows, Home and End moving round it", () => {
    const { item } = setup();
    expect(screen.getByRole("menu", { name: "Pick" })).toHaveTextContent("Pick one");
    expect(document.activeElement).toBe(item("One"));
    fireEvent.keyDown(item("One"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(item("Three"));
    fireEvent.keyDown(item("Three"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("One"));
    fireEvent.keyDown(item("One"), { key: "End" });
    expect(document.activeElement).toBe(item("Three"));
    fireEvent.keyDown(item("Three"), { key: "Home" });
    expect(document.activeElement).toBe(item("One"));
  });

  it("starts on the item it is told to", () => {
    const { item } = setup({ initialIndex: 1 });
    expect(document.activeElement).toBe(item("Two"));
  });

  it("closes on Escape and gives focus back to what opened it", () => {
    const { onClose, opener, item } = setup();
    fireEvent.keyDown(item("One"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });

  it("closes on a press outside without pulling focus back, and leaves the opener's own press to it", () => {
    const { onClose, opener } = setup({ opener: () => screen.getByRole("button", { name: "Opener" }) });
    fireEvent.mouseDown(opener);
    expect(onClose).not.toHaveBeenCalled();
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    fireEvent.mouseDown(elsewhere);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(opener);
  });

  it("lets the caller take a key first", () => {
    const onKey = vi.fn((e: KeyboardEvent) => e.key === "y");
    const { item } = setup({ onKey });
    fireEvent.keyDown(item("One"), { key: "y" });
    expect(onKey).toHaveBeenCalled();
    fireEvent.keyDown(item("One"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("Two"));
  });
});
