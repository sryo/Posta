import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRowDrag } from "./rowDrag";

let under: Element | null = null;
beforeEach(() => {
  document.body.innerHTML = `
    <div class="card" data-id="inbox"><div class="thread" data-thread-id="t1">First<button class="thread-draft-discard">Discard</button><div class="thread-checkbox-wrap"><input type="checkbox"></div></div></div>
    <div class="card" data-id="receipts"><div class="card-header">Receipts</div></div>`;
  under = null;
  document.elementFromPoint = () => under;
});
afterEach(() => {
  document.body.innerHTML = "";
});

const row = () => document.querySelector<HTMLElement>('[data-thread-id="t1"]')!;
const receipts = () => document.querySelector<HTMLElement>('[data-id="receipts"] .card-header')!;
const pointer = (type: string, target: EventTarget, init: PointerEventInit = {}) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, ...init }));

// The row, ready to be dragged
function draggable(onDrop = vi.fn()) {
  const drag = createRowDrag({ onDrop });
  row().addEventListener("pointerdown", e => drag.press(e, "inbox", "t1"));
  return { drag, onDrop };
}

describe("createRowDrag", () => {
  it("doesn't start until the pointer has moved a few pixels", () => {
    const { drag } = draggable();
    pointer("pointerdown", row(), { clientX: 10, clientY: 10 });
    pointer("pointermove", document, { clientX: 13, clientY: 12 });
    expect(drag.dragging()).toBeNull();
    pointer("pointermove", document, { clientX: 20, clientY: 10 });
    expect(drag.dragging()).toMatchObject({ threadId: "t1", sourceCardId: "inbox", overCardId: null, alt: false });
  });

  it("names the card under the pointer, and whether ⌥ is held", () => {
    const { drag } = draggable();
    pointer("pointerdown", row(), { clientX: 10, clientY: 10 });
    under = receipts();
    pointer("pointermove", document, { clientX: 400, clientY: 50 });
    expect(drag.dragging()).toMatchObject({ overCardId: "receipts", alt: false });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true }));
    expect(drag.dragging()).toMatchObject({ alt: true });
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    expect(drag.dragging()).toMatchObject({ alt: false });
  });

  it("marks the page as dragging, so no text gets selected on the way, until the drop", () => {
    draggable();
    pointer("pointerdown", row(), { clientX: 10, clientY: 10 });
    pointer("pointermove", document, { clientX: 40, clientY: 30 });
    expect(document.documentElement).toHaveClass("row-dragging");
    pointer("pointerup", document, { clientX: 40, clientY: 30 });
    expect(document.documentElement).not.toHaveClass("row-dragging");
  });

  it("carries a raised copy of the row under the pointer and dims the row", () => {
    draggable();
    pointer("pointerdown", row(), { clientX: 10, clientY: 10 });
    pointer("pointermove", document, { clientX: 40, clientY: 30 });
    const ghost = document.querySelector<HTMLElement>(".row-ghost")!;
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    expect(ghost.querySelector(".thread-checkbox-wrap")).toBeNull();
    // Held where the pointer took hold of the row (its box is at 0, 0 here)
    expect(ghost.style.transform).toBe("translate(30px, 20px)");
    expect(row()).toHaveClass("lifting");
  });

  it("drops on the card under the pointer, and the click that ends it opens nothing", () => {
    const { onDrop } = draggable();
    const opened = vi.fn();
    row().addEventListener("click", opened);
    pointer("pointerdown", row(), { clientX: 10, clientY: 10 });
    under = receipts();
    pointer("pointermove", document, { clientX: 400, clientY: 50, altKey: true });
    pointer("pointerup", document, { clientX: 400, clientY: 50, altKey: true });
    row().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ threadId: "t1", sourceCardId: "inbox", overCardId: "receipts", alt: true }), expect.objectContaining({ left: expect.any(Number) }));
    expect(opened).not.toHaveBeenCalled();
    expect(document.querySelector(".row-ghost")).toBeNull();
    expect(row()).not.toHaveClass("lifting");
  });

  it("lets a click elsewhere through right after a drop", () => {
    const { onDrop } = draggable();
    const undo = document.createElement("button");
    const pressed = vi.fn();
    undo.addEventListener("click", pressed);
    document.body.append(undo);
    pointer("pointerdown", row(), { clientX: 10, clientY: 10 });
    under = receipts();
    pointer("pointermove", document, { clientX: 400, clientY: 50 });
    pointer("pointerup", document, { clientX: 400, clientY: 50 });
    expect(onDrop).toHaveBeenCalled();
    undo.click();
    expect(pressed).toHaveBeenCalled();
  });

  it("puts the row back on Escape", () => {
    const { drag, onDrop } = draggable();
    pointer("pointerdown", row(), { clientX: 10, clientY: 10 });
    under = receipts();
    pointer("pointermove", document, { clientX: 400, clientY: 50 });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(drag.dragging()).toBeNull();
    pointer("pointerup", document, { clientX: 400, clientY: 50 });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("can be called off from outside, as when the board goes", () => {
    const { drag, onDrop } = draggable();
    pointer("pointerdown", row(), { clientX: 10, clientY: 10 });
    pointer("pointermove", document, { clientX: 60, clientY: 10 });
    drag.cancel();
    expect(drag.dragging()).toBeNull();
    expect(document.querySelector(".row-ghost")).toBeNull();
    pointer("pointerup", document, { clientX: 60, clientY: 10 });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("leaves a plain click alone", () => {
    const { onDrop } = draggable();
    const opened = vi.fn();
    row().addEventListener("click", opened);
    pointer("pointerdown", row(), { clientX: 10, clientY: 10 });
    pointer("pointerup", document, { clientX: 10, clientY: 10 });
    row().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onDrop).not.toHaveBeenCalled();
    expect(opened).toHaveBeenCalled();
  });

  it("doesn't take a press on the row's controls", () => {
    const { drag } = draggable();
    pointer("pointerdown", document.querySelector(".thread-draft-discard")!, { clientX: 10, clientY: 10 });
    pointer("pointermove", document, { clientX: 60, clientY: 10 });
    expect(drag.dragging()).toBeNull();
  });
});
