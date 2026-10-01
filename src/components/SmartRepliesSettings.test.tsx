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
  it("turns on from a switch that asks for a key", () => {
    renderSection();
    const toggle = screen.getByRole("switch", { name: "Suggest replies" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByLabelText("Gemini API key")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Gemini API key")).toBeInTheDocument();
  });

  it("says what is sent to Google and where to get a key", () => {
    renderSection();
    expect(screen.getByText("Uses Google Gemini. Each email you open is sent to Google.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Suggest replies" }));
    expect(screen.getByRole("link", { name: "Google AI Studio" })).toHaveAttribute("href", "https://aistudio.google.com/apikey");
  });

  it("saves a typed key", () => {
    const { onSave } = renderSection();
    fireEvent.click(screen.getByRole("switch", { name: "Suggest replies" }));
    const field = screen.getByLabelText("Gemini API key");
    fireEvent.input(field, { target: { value: "AIza-new" } });
    fireEvent.change(field, { target: { value: "AIza-new" } });
    expect(onSave).toHaveBeenCalledWith("AIza-new");
  });

  it("is on with a saved key, kept in Keychain, and turning it off removes the key", () => {
    const { onSave } = renderSection(true);
    const toggle = screen.getByRole("switch", { name: "Suggest replies" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Saved in Keychain")).toBeInTheDocument();
    expect(screen.queryByLabelText("Gemini API key")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(onSave).toHaveBeenCalledWith("");
  });
});
