import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { CardForm } from "./CardForm";

function renderCardForm(mode: "new" | "edit") {
  render(() => (
    <CardForm
      mode={mode}
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
}

describe("CardForm", () => {
  it.each(["new", "edit"] as const)("focuses the name field in %s mode", async (mode) => {
    renderCardForm(mode);
    await new Promise(r => setTimeout(r, 100));
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Inbox, Starred..."));
  });
});
