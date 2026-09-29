import { describe, expect, it, vi } from "vitest";
import { createSignal, Show } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { Dialog } from "./Dialog";

function renderDialog(onClose = vi.fn()) {
  const [open, setOpen] = createSignal(false);
  const result = render(() => (
    <>
      <main data-board>
        <button onClick={() => setOpen(true)}>Open</button>
      </main>
      <Show when={open()}>
        <Dialog class="sheet" labelledBy="sheet-title" onClose={() => { onClose(); setOpen(false); }}>
          <h2 id="sheet-title">Sheet</h2>
          <button>First</button>
          <button disabled>Disabled</button>
          <button>Last</button>
        </Dialog>
      </Show>
    </>
  ));
  const opener = screen.getByText("Open");
  opener.focus();
  fireEvent.click(opener);
  return { ...result, opener, setOpen, onClose };
}

describe("Dialog", () => {
  it("is a modal dialog named by its heading, focused on opening", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog", { name: "Sheet" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("keeps Tab inside the dialog", () => {
    renderDialog();
    const first = screen.getByText("First");
    const last = screen.getByText("Last");
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("makes the board behind it inert while open", () => {
    const { container, setOpen } = renderDialog();
    const board = container.querySelector("[data-board]")!;
    expect(board).toHaveAttribute("inert");
    setOpen(false);
    expect(board).not.toHaveAttribute("inert");
  });

  it("closes on Escape and gives focus back to what opened it", () => {
    const { opener, onClose } = renderDialog();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
