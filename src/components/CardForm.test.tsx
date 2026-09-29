import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { GroupBy } from "../shared/constants";
import { CardForm } from "./CardForm";

function renderCardForm(mode: "new" | "edit", init: { query?: string; groupBy?: GroupBy; setColor?: (c: any) => void; setColorPickerOpen?: (v: boolean) => void; onCancel?: () => void; debounceQueryPreview?: (q: string) => void } = {}) {
  const [query, setQuery] = createSignal(init.query ?? "is:inbox");
  const [groupBy, setGroupBy] = createSignal<GroupBy>(init.groupBy ?? "date");
  render(() => (
    <CardForm
      mode={mode}
      name="Inbox"
      setName={vi.fn()}
      query={query()}
      setQuery={setQuery}
      color={null}
      setColor={init.setColor ?? vi.fn()}
      groupBy={groupBy()}
      setGroupBy={setGroupBy}
      colorPickerOpen={false}
      setColorPickerOpen={init.setColorPickerOpen ?? vi.fn()}
      onSave={vi.fn()}
      onCancel={init.onCancel ?? vi.fn()}
      saveDisabled={false}
      setQueryHelpOpen={vi.fn()}
      suggestQuery={() => []}
      contacts={[]}
      labelNames={[]}
      debounceQueryPreview={init.debounceQueryPreview ?? vi.fn()}
      onQueryFieldActive={vi.fn()}
    />
  ));
  return { groupBy, query };
}

describe("CardForm", () => {
  it.each(["new", "edit"] as const)("focuses the name field in %s mode", async (mode) => {
    renderCardForm(mode);
    await new Promise(r => setTimeout(r, 100));
    expect(document.activeElement).toBe(screen.getByPlaceholderText("e.g. Clients"));
  });
});

describe("CardForm while an input method is composing", () => {
  it("does not discard the form on the Escape that cancels a composition", () => {
    const onCancel = vi.fn();
    renderCardForm("new", { onCancel });
    fireEvent.keyDown(screen.getByPlaceholderText("e.g. Clients"), { key: "Escape", isComposing: true });
    fireEvent.keyDown(screen.getByPlaceholderText("e.g. from:boss is:unread newer_than:7d"), { key: "Escape", isComposing: true });
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByPlaceholderText("e.g. Clients"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("CardForm grouping", () => {
  const active = () => document.querySelector(".group-by-btn.active")?.textContent;

  it("falls back to date grouping when the query switches card type", () => {
    const { groupBy } = renderCardForm("edit", { groupBy: "sender" });
    expect(active()).toBe("Sender");
    fireEvent.input(screen.getByPlaceholderText("e.g. from:boss is:unread newer_than:7d"), { target: { value: "calendar:today" } });
    expect(groupBy()).toBe("date");
    expect(active()).toBe("Date");
  });

  it("keeps a grouping that the card type offers", () => {
    const { groupBy } = renderCardForm("edit", { query: "calendar:week", groupBy: "organizer" });
    expect(groupBy()).toBe("organizer");
    expect(active()).toBe("Organizer");
  });
});

describe("CardForm color picker keyboard access", () => {
  it("opens the picker and picks a color from the keyboard", () => {
    const setColor = vi.fn();
    const setColorPickerOpen = vi.fn();
    renderCardForm("new", { setColor, setColorPickerOpen });
    const selected = document.querySelector<HTMLElement>(".color-picker-selected")!;
    expect(selected.tabIndex).toBe(0);
    // App-level shortcuts (Enter opens the focused thread) must not see it
    const globalShortcut = vi.fn();
    document.addEventListener("keydown", globalShortcut);
    fireEvent.keyDown(selected, { key: "Enter" });
    document.removeEventListener("keydown", globalShortcut);
    expect(setColorPickerOpen).toHaveBeenCalledWith(true);
    expect(globalShortcut).not.toHaveBeenCalled();
    const blue = document.querySelector<HTMLElement>(".color-option.blue")!;
    expect(blue.getAttribute("role")).toBe("button");
    fireEvent.keyDown(blue, { key: " " });
    expect(setColor).toHaveBeenCalledWith("blue");
    fireEvent.keyDown(document.querySelector<HTMLElement>(".no-color-option")!, { key: "Enter" });
    expect(setColor).toHaveBeenLastCalledWith(null);
  });
});

describe("CardForm query", () => {
  it("previews the query as it is typed", () => {
    const debounceQueryPreview = vi.fn();
    const { query } = renderCardForm("new", { query: "", debounceQueryPreview });
    fireEvent.input(screen.getByPlaceholderText("e.g. from:boss is:unread newer_than:7d"), { target: { value: "is:starred" } });
    expect(query()).toBe("is:starred");
    expect(debounceQueryPreview).toHaveBeenCalledWith("is:starred");
  });

  it("previews the query again when a chip changes it", () => {
    const debounceQueryPreview = vi.fn();
    const { query } = renderCardForm("edit", { query: "is:unread invoice", debounceQueryPreview });
    fireEvent.click(screen.getByRole("button", { name: "Remove is:unread" }));
    expect(query()).toBe("invoice");
    expect(debounceQueryPreview).toHaveBeenCalledWith("invoice");
  });
});
