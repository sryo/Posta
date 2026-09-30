import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { GroupBy } from "../shared/constants";
import { CardForm } from "./CardForm";

function renderCardForm(mode: "new" | "edit", init: { query?: string; groupBy?: GroupBy; setColor?: (c: any) => void; setColorPickerOpen?: (v: boolean) => void; colorPickerOpen?: boolean; onCancel?: () => void; onSave?: () => void; dirty?: () => boolean; debounceQueryPreview?: (q: string) => void } = {}) {
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
      colorPickerOpen={init.colorPickerOpen ?? false}
      setColorPickerOpen={init.setColorPickerOpen ?? vi.fn()}
      onSave={init.onSave ?? vi.fn()}
      onCancel={init.onCancel ?? vi.fn()}
      saveDisabled={false}
      dirty={init.dirty?.()}
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
  const active = () => document.querySelector('[aria-label="Group by"] [aria-pressed="true"]')?.textContent;

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

describe("CardForm color", () => {
  it("opens the flower from the header's dot and picks a color from it", () => {
    const setColor = vi.fn();
    const setColorPickerOpen = vi.fn();
    renderCardForm("new", { setColor, setColorPickerOpen, colorPickerOpen: true });
    const dot = screen.getByRole("button", { name: "Card color" });
    expect(dot.closest(".card-edit-header")).not.toBeNull();
    // App-level shortcuts (Enter opens the focused thread) must not see it
    const globalShortcut = vi.fn();
    document.addEventListener("keydown", globalShortcut);
    fireEvent.keyDown(dot, { key: "Enter" });
    document.removeEventListener("keydown", globalShortcut);
    expect(setColorPickerOpen).toHaveBeenCalledWith(false);
    expect(globalShortcut).not.toHaveBeenCalled();
    const blue = screen.getByRole("menuitemradio", { name: "Blue" });
    fireEvent.keyDown(blue, { key: "ArrowRight" });
    fireEvent.click(blue);
    expect(setColor).toHaveBeenCalledWith("blue");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "No color" }));
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

describe("CardForm header", () => {
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

  it("puts cancel and ✓ where refresh and edit sit, ✓ last", () => {
    renderCardForm("edit");
    const actions = document.querySelector(".card-edit-header .card-edit-actions")!;
    expect([...actions.querySelectorAll("button")].map(b => b.getAttribute("aria-label"))).toEqual(["Cancel", "Save"]);
  });

  it("closes with ✓ when nothing changed, and saves once something has", async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const [dirty, setDirty] = createSignal(false);
    renderCardForm("edit", { onSave, onCancel, dirty });
    await wait(350);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    setDirty(true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("ignores ✓ right after opening, so the double-click that opened it doesn't save", async () => {
    // The clock only moves when the test says, so a slow query can't outlast the guard
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const onSave = vi.fn();
      renderCardForm("edit", { onSave });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).not.toHaveBeenCalled();
      vi.setSystemTime(Date.now() + 350);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names a new card's ✓ Add", () => {
    renderCardForm("new");
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("moves from the name to the query on Enter", async () => {
    renderCardForm("edit");
    await wait(10);
    fireEvent.keyDown(screen.getByPlaceholderText("e.g. Clients"), { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByPlaceholderText("e.g. from:boss is:unread newer_than:7d"));
  });
});

describe("CardForm account", () => {
  const accounts = [
    { id: "a", email: "a@x.com", picture: null, signature: null },
    { id: "b", email: "b@x.com", picture: null, signature: null },
  ];
  function renderWithAccounts(list: typeof accounts, setAccountId = vi.fn()) {
    render(() => (
      <CardForm
        mode="edit"
        name="Inbox"
        setName={vi.fn()}
        query="is:inbox"
        setQuery={vi.fn()}
        color={null}
        setColor={vi.fn()}
        groupBy="date"
        setGroupBy={vi.fn()}
        colorPickerOpen={false}
        setColorPickerOpen={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        saveDisabled={false}
        setQueryHelpOpen={vi.fn()}
        suggestQuery={() => []}
        contacts={[]}
        labelNames={[]}
        debounceQueryPreview={vi.fn()}
        onQueryFieldActive={vi.fn()}
        accounts={list}
        accountId="b"
        setAccountId={setAccountId}
      />
    ));
    return setAccountId;
  }

  it("offers every account and all of them once there is more than one", () => {
    const setAccountId = renderWithAccounts(accounts);
    const select = screen.getByRole("combobox", { name: "Account" }) as HTMLSelectElement;
    expect([...select.options].map(o => [o.value, o.textContent])).toEqual([["all", "All inboxes"], ["a", "a@x.com"], ["b", "b@x.com"]]);
    expect(select.value).toBe("b");

    fireEvent.change(select, { target: { value: "all" } });
    expect(setAccountId).toHaveBeenCalledWith("all");
  });

  it("asks nothing with one account", () => {
    renderWithAccounts(accounts.slice(0, 1));
    expect(screen.queryByRole("combobox", { name: "Account" })).not.toBeInTheDocument();
  });
});
