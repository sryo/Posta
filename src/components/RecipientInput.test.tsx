import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { RecipientInput } from "./RecipientInput";

const CONTACTS = [
  { email: "ana@estudio.test", name: "Ana Pérez" },
  { email: "lucas@acme.test", name: "Lucas Romero" },
];

function renderInput(initial = "", onKeyDown = vi.fn()) {
  const [value, setValue] = createSignal(initial);
  const onChange = vi.fn((v: string) => setValue(v));
  const suggest = vi.fn((q: string) => CONTACTS.filter(c => c.email.includes(q.toLowerCase()) || c.name.toLowerCase().includes(q.toLowerCase())));
  render(() => (
    <RecipientInput id="to" value={value()} onChange={onChange} suggest={suggest} placeholder="Recipients" onKeyDown={onKeyDown} />
  ));
  const input = screen.getByPlaceholderText("Recipients") as HTMLInputElement;
  const type = (text: string) => fireEvent.input(input, { target: { value: text } });
  return { input, value, onChange, type, onKeyDown };
}

describe("RecipientInput", () => {
  it("is a combobox that stays closed until something is typed", () => {
    const { input, type } = renderInput();
    expect(input).toHaveAttribute("role", "combobox");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    fireEvent.focus(input);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveAttribute("aria-expanded", "false");

    type("a");
    const list = screen.getByRole("listbox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", list.id);
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("points aria-activedescendant at the highlighted option as the arrows move", () => {
    const { input, type } = renderInput();
    fireEvent.focus(input);
    type("a");
    const options = screen.getAllByRole("option");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", options[1].id);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
  });

  it("commits the highlighted contact with Enter or Tab, after earlier recipients", () => {
    const first = renderInput("bo@x.test, ");
    fireEvent.focus(first.input);
    first.type("bo@x.test, luc");
    fireEvent.keyDown(first.input, { key: "Tab" });
    expect(first.value()).toBe("bo@x.test, lucas@acme.test");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(first.onKeyDown).not.toHaveBeenCalled();
  });

  it("commits with Enter and a click too", () => {
    const { input, type, value } = renderInput();
    fireEvent.focus(input);
    type("ana");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(value()).toBe("ana@estudio.test");

    type("ana@estudio.test, lu");
    fireEvent.mouseDown(screen.getByText("Lucas Romero"));
    expect(value()).toBe("ana@estudio.test, lucas@acme.test");
  });

  it("leaves Tab to move focus when no suggestion is showing", () => {
    const { input, onKeyDown } = renderInput();
    fireEvent.focus(input);
    const tab = fireEvent.keyDown(input, { key: "Tab" });
    expect(tab).toBe(true);
    expect(onKeyDown).toHaveBeenCalled();
  });

  it("closes the suggestions on Escape without passing it on, then passes the next one", () => {
    const { input, type, onKeyDown } = renderInput();
    fireEvent.focus(input);
    type("a");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("offers nothing once the recipient being typed is finished", () => {
    const { input, type } = renderInput();
    fireEvent.focus(input);
    type("ana@estudio.test, ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("leaves keys to an input method that is composing", () => {
    const { input, type, value } = renderInput();
    fireEvent.focus(input);
    type("an");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(value()).toBe("an");
  });
});

describe("RecipientInput suggestion notes", () => {
  it("shows a suggestion's note under its address", () => {
    const [value, setValue] = createSignal("");
    render(() => (
      <RecipientInput id="to" value={value()} onChange={setValue} placeholder="Recipients" suggest={() => [
        { email: "ana@lumen.studio", name: "Ana Pérez", note: "Writes from here since August" },
        { email: "aperez@estudiomr.com.ar", name: "Ana Pérez", note: "Last heard from here in July 2025" },
      ]} />
    ));
    const input = screen.getByPlaceholderText("Recipients");
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "ana" } });
    const [first, second] = screen.getAllByRole("option");
    expect(first).toHaveTextContent("ana@lumen.studioWrites from here since August");
    expect(second).toHaveTextContent("Last heard from here in July 2025");
  });
});

describe("RecipientInput pasting a list", () => {
  const clipboard = (text: string) => ({ clipboardData: { types: ["text/plain"], files: [], items: [], getData: (type: string) => (type === "text/plain" ? text : "") } });

  it("tidies a pasted list into recipients and says what it did until the next key", () => {
    const { input, value } = renderInput("Ana Pérez <ana@estudio.test>, ");
    fireEvent.paste(input, clipboard("ana@estudio.test; \"Bruno Sosa\" bruno@sosa.dev\nlucas@acme.test, Pablo (no email yet)"));
    expect(value()).toBe('Ana Pérez <ana@estudio.test>, "Bruno Sosa" <bruno@sosa.dev>, "Lucas Romero" <lucas@acme.test>, Pablo');
    expect(screen.getByRole("status")).toHaveTextContent("Added 2 · Ana was already here · “Pablo” has no address, left for you");
    fireEvent.keyDown(input, { key: "a" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leaves a single pasted address to the ordinary paste", () => {
    const { input, onChange } = renderInput();
    const event = clipboard("ana@estudio.test");
    expect(fireEvent.paste(input, event)).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
