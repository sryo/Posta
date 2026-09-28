import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { GroupBy } from "../shared/constants";
import { CardForm } from "./CardForm";

function renderCardForm(mode: "new" | "edit", init: { query?: string; groupBy?: GroupBy } = {}) {
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
      setColor={vi.fn()}
      groupBy={groupBy()}
      setGroupBy={setGroupBy}
      colorPickerOpen={false}
      setColorPickerOpen={vi.fn()}
      onSave={vi.fn()}
      onCancel={vi.fn()}
      saveDisabled={false}
      setQueryHelpOpen={vi.fn()}
      setQueryInputRef={vi.fn()}
      getQuerySuggestions={() => []}
      queryAutocompleteOpen={() => false}
      setQueryAutocompleteOpen={vi.fn()}
      queryAutocompleteIndex={() => 0}
      setQueryAutocompleteIndex={vi.fn()}
      updateDropdownPosition={vi.fn()}
      debounceQueryPreview={vi.fn()}
      setActiveQueryGetter={vi.fn() as any}
      setActiveQuerySetter={vi.fn() as any}
      applyQuerySuggestion={vi.fn()}
    />
  ));
  return { groupBy };
}

describe("CardForm", () => {
  it.each(["new", "edit"] as const)("focuses the name field in %s mode", async (mode) => {
    renderCardForm(mode);
    await new Promise(r => setTimeout(r, 100));
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Inbox, Starred..."));
  });
});

describe("CardForm grouping", () => {
  const active = () => document.querySelector(".group-by-btn.active")?.textContent;

  it("falls back to date grouping when the query switches card type", () => {
    const { groupBy } = renderCardForm("edit", { groupBy: "sender" });
    expect(active()).toBe("Sender");
    fireEvent.input(screen.getByPlaceholderText("is:inbox, from:boss, newer_than:7d"), { target: { value: "calendar:today" } });
    expect(groupBy()).toBe("date");
    expect(active()).toBe("Date");
  });

  it("keeps a grouping that the card type offers", () => {
    const { groupBy } = renderCardForm("edit", { query: "calendar:week", groupBy: "organizer" });
    expect(groupBy()).toBe("organizer");
    expect(active()).toBe("Organizer");
  });
});
