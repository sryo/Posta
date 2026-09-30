import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { RadialMenu, type RadialItem } from "./RadialMenu";
import { ReplyIcon } from "./Icons";

// jsdom has no layout, so which element sits under the pointer is set by hand
function stubElementFromPoint() {
  let el: Element | null = null;
  const doc = document as unknown as Record<string, unknown>;
  const original = doc.elementFromPoint;
  doc.elementFromPoint = () => el;
  return {
    mockReturnValue: (next: Element | null) => { el = next; },
    restore: () => { if (original) doc.elementFromPoint = original; else delete doc.elementFromPoint; },
  };
}

const actions = (onSelect = vi.fn()): RadialItem[] => ["Reply", "Forward", "Archive"].map((label, i) => ({
  id: label, label, hint: "rfa"[i], icon: ReplyIcon, onSelect,
}));

describe("RadialMenu", () => {
  it("blooms a frame after opening, each petal placed along its angle", async () => {
    render(() => <RadialMenu label="Actions" items={actions()} open arc={{ start: -60, span: 120 }} radius={40} itemSize={28} />);
    const menu = screen.getByRole("menu", { name: "Actions" });
    await waitFor(() => expect(menu).toHaveClass("open"));
    const petals = screen.getAllByRole("menuitem");
    expect(petals.map(p => [p.style.getPropertyValue("--x"), p.style.getPropertyValue("--y")])).toEqual([
      ["20px", "-34.64px"], ["40px", "0px"], ["20px", "34.64px"],
    ]);
  });

  it("names each petal without its key hint, and shows the hint beside it", () => {
    render(() => <RadialMenu label="Actions" items={actions()} open arc={{ start: -60, span: 120 }} radius={40} itemSize={28} />);
    const reply = screen.getByRole("menuitem", { name: "Reply" });
    expect(reply.querySelector(".action-key-hint")).toHaveTextContent("r");
  });

  it("keeps a closed menu out of the accessibility tree and the tab order", () => {
    render(() => <RadialMenu label="Actions" items={actions()} open={false} arc={{ start: -60, span: 120 }} radius={40} itemSize={28} />);
    expect(screen.queryByRole("menu")).toBeNull();
    for (const petal of document.querySelectorAll("button")) expect(petal.tabIndex).toBe(-1);
  });

  it("steps round the ring with the arrow keys and leaves it with Escape", () => {
    const onEscape = vi.fn();
    render(() => <RadialMenu label="Actions" items={actions()} open arc={{ start: -60, span: 120 }} radius={40} itemSize={28} onEscape={onEscape} />);
    const [reply, forward, archive] = screen.getAllByRole("menuitem");
    expect([reply.tabIndex, forward.tabIndex]).toEqual([0, -1]);
    reply.focus();
    fireEvent.keyDown(reply, { key: "ArrowRight" });
    expect(document.activeElement).toBe(forward);
    fireEvent.keyDown(forward, { key: "End" });
    expect(document.activeElement).toBe(archive);
    fireEvent.keyDown(archive, { key: "ArrowDown" });
    expect(document.activeElement).toBe(reply);
    fireEvent.keyDown(reply, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("offers colours as a choice of one, the current one checked and first in the tab order", () => {
    const [color, setColor] = createSignal<string | null>("blue");
    const items = (): RadialItem[] => [null, "red", "blue"].map(hue => ({
      id: hue ?? "none", label: hue ?? "No color", hue, selected: hue === color(), onSelect: () => setColor(hue),
    }));
    render(() => <RadialMenu label="Color" items={items()} open arc={{ start: 0, span: 360 }} radius={30} itemSize={20} />);
    const blue = screen.getByRole("menuitemradio", { name: "blue" });
    expect(blue).toHaveAttribute("aria-checked", "true");
    expect(blue.tabIndex).toBe(0);
    expect(screen.getByRole("menuitemradio", { name: "No color" })).toHaveClass("no-color");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "red" }));
    expect(screen.getByRole("menuitemradio", { name: "red" })).toHaveAttribute("aria-checked", "true");
  });

  it("lets a held press slide across petals, previewing each, and chooses the one it is let go on", () => {
    const chosen = vi.fn();
    const onScrub = vi.fn();
    const items = ["red", "green", "blue"].map(hue => ({ id: hue, label: hue, hue, onSelect: () => chosen(hue) }));
    render(() => <RadialMenu label="Color" items={items} open arc={{ start: 0, span: 180 }} radius={30} itemSize={20} onScrub={onScrub} />);
    const [red, green, blue] = screen.getAllByRole("menuitemradio");
    const under = stubElementFromPoint();
    fireEvent.pointerDown(red, { button: 0 });
    under.mockReturnValue(green);
    fireEvent.pointerMove(document, { clientX: 1, clientY: 1 });
    expect(onScrub).toHaveBeenLastCalledWith(items[1]);
    expect(green).toHaveClass("scrubbed");
    under.mockReturnValue(blue);
    fireEvent.pointerMove(document, { clientX: 2, clientY: 2 });
    fireEvent.pointerUp(document, { clientX: 2, clientY: 2 });
    fireEvent.click(blue);
    expect(chosen.mock.calls).toEqual([["blue"]]);
    under.restore();
  });

  it("puts back what it previewed when the press is let go off every petal", () => {
    const onScrub = vi.fn();
    const items = ["red", "green"].map(hue => ({ id: hue, label: hue, hue, onSelect: vi.fn() }));
    render(() => <RadialMenu label="Color" items={items} open arc={{ start: 0, span: 180 }} radius={30} itemSize={20} onScrub={onScrub} />);
    const [red, green] = screen.getAllByRole("menuitemradio");
    const under = stubElementFromPoint();
    fireEvent.pointerDown(red, { button: 0 });
    under.mockReturnValue(green);
    fireEvent.pointerMove(document, { clientX: 1, clientY: 1 });
    under.mockReturnValue(document.body);
    fireEvent.pointerUp(document, { clientX: 99, clientY: 99 });
    expect(onScrub).toHaveBeenLastCalledWith(null);
    expect(items.every(item => (item.onSelect as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true);
    under.restore();
  });
});
