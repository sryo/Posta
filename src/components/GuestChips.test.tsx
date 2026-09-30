import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { GuestChips } from "./GuestChips";

const contacts = [
  { email: "ana@x.test", name: "Ana Pérez" },
  { email: "lucas@x.test", name: "Lucas Romero" },
  { email: "sofia@x.test" },
];

function renderChips(initial = "") {
  const [value, setValue] = createSignal(initial);
  const outer = vi.fn();
  const suggest = (q: string) => contacts.filter(c => (c.email + (c.name ?? "")).toLowerCase().includes(q.toLowerCase()));
  render(() => <div onKeyDown={outer}><GuestChips value={value()} onChange={setValue} suggest={suggest} /></div>);
  return { value, outer, input: screen.getByRole("combobox", { name: "Guests" }) as HTMLInputElement };
}

const chipTexts = () => Array.from(document.querySelectorAll(".guest-chip .chip-label")).map(el => el.textContent);

describe("GuestChips", () => {
  it("shows each guest as a chip, by name when there is one", () => {
    renderChips('"Ana Pérez" <ana@x.test>, lucas@x.test');
    expect(chipTexts()).toEqual(["Ana Pérez", "lucas@x.test"]);
  });

  it("adds a typed address on Enter or comma", () => {
    const { input, value } = renderChips();
    fireEvent.input(input, { target: { value: "bo@y.test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.input(input, { target: { value: "cy@y.test" } });
    fireEvent.keyDown(input, { key: "," });
    expect(value()).toBe("bo@y.test, cy@y.test");
    expect(input.value).toBe("");
  });

  it("turns a pasted list into chips and keeps the unfinished rest to type on", () => {
    const { input, value } = renderChips("a@y.test");
    fireEvent.input(input, { target: { value: '"Bo Díaz" <bo@y.test>, cy@y.test; lu' } });
    expect(value()).toBe('a@y.test, "Bo Díaz" <bo@y.test>, cy@y.test');
    expect(input.value).toBe("lu");
    expect(screen.getByRole("option", { name: /Lucas Romero/ })).toBeInTheDocument();
  });

  it("keeps text before a separator that isn't an address", () => {
    const { input, value } = renderChips("a@y.test");
    fireEvent.input(input, { target: { value: "Díaz; Bo <bo@y.test>" } });
    expect(value()).toBe("a@y.test");
    expect(input.value).toBe("Díaz; Bo <bo@y.test>");
  });

  it("adds what was typed when focus leaves", () => {
    const { input, value } = renderChips("a@y.test");
    fireEvent.input(input, { target: { value: "b@y.test" } });
    fireEvent.blur(input);
    expect(value()).toBe("a@y.test, b@y.test");
  });

  it("suggests contacts as the user types and adds the chosen one", () => {
    const { input, value } = renderChips();
    fireEvent.input(input, { target: { value: "luc" } });
    const list = screen.getByRole("listbox", { name: "Guest suggestions" });
    expect(list).toHaveTextContent("Lucas Romero");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(value()).toBe('"Lucas Romero" <lucas@x.test>');
  });

  it("moves through suggestions with the arrow keys and picks with the mouse", () => {
    const { input, value } = renderChips();
    fireEvent.input(input, { target: { value: "x.test" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.mouseDown(screen.getAllByRole("option")[2]);
    expect(value()).toBe("sofia@x.test");
  });

  it("leaves out guests already on the event", () => {
    const { input } = renderChips("ana@x.test");
    fireEvent.input(input, { target: { value: "x.test" } });
    expect(screen.getAllByRole("option").map(o => o.textContent)).not.toContain(expect.stringContaining("Ana"));
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("removes a guest with its button, or the last one with Backspace", () => {
    const { input, value } = renderChips("a@y.test, b@y.test, c@y.test");
    fireEvent.click(screen.getByRole("button", { name: "Remove b@y.test" }));
    expect(value()).toBe("a@y.test, c@y.test");
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(value()).toBe("a@y.test");
  });

  it("closes suggestions on Escape without closing the form", () => {
    const { input, outer } = renderChips();
    fireEvent.input(input, { target: { value: "luc" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(outer).not.toHaveBeenCalled();
  });

  it("does not add a duplicate", () => {
    const { input, value } = renderChips("ana@x.test");
    fireEvent.input(input, { target: { value: "ANA@x.test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(value()).toBe("ana@x.test");
  });
});
