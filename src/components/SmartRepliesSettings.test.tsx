import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { SmartRepliesSettings } from "./SmartRepliesSettings";

function renderSection(keySaved: boolean | undefined = false) {
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const onSave = vi.fn();
  render(() => (
    <SmartRepliesSettings
      open={open()}
      onToggle={() => setOpen(!open())}
      keySaved={keySaved}
      draft={draft()}
      onDraft={setDraft}
      onSave={onSave}
    />
  ));
  return { onSave };
}

describe("SmartRepliesSettings", () => {
  it("opens from a real button that says whether it is expanded", () => {
    renderSection();
    const title = screen.getByRole("button", { name: /Smart replies/ });
    expect(title).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Gemini API key")).not.toBeInTheDocument();
    fireEvent.click(title);
    expect(title).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Gemini API key")).toBeInTheDocument();
  });

  it("says what is sent to Google and where to get a key", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Smart replies/ }));
    expect(screen.getByText(/Suggests replies with Google Gemini\. When on, the text of each email you open is sent to Google\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Google AI Studio" })).toHaveAttribute("href", "https://aistudio.google.com/apikey");
  });

  it("saves a typed key", () => {
    const { onSave } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Smart replies/ }));
    const field = screen.getByLabelText("Gemini API key");
    fireEvent.input(field, { target: { value: "AIza-new" } });
    fireEvent.change(field, { target: { value: "AIza-new" } });
    expect(onSave).toHaveBeenCalledWith("AIza-new");
  });

  it("shows a saved key as kept in Keychain, with a way to remove it", () => {
    const { onSave } = renderSection(true);
    fireEvent.click(screen.getByRole("button", { name: /Smart replies/ }));
    expect(screen.getByText(/Saved in Keychain/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Gemini API key")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onSave).toHaveBeenCalledWith("");
  });
});
