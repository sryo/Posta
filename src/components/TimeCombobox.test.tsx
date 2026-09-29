import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { TimeCombobox } from "./TimeCombobox";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function renderCombobox(initial = "10:00", onChange = vi.fn()) {
  const [value, setValue] = createSignal(initial);
  const change = (v: string) => { onChange(v); setValue(v); };
  const outer = vi.fn();
  render(() => (
    <div onKeyDown={outer}>
      <TimeCombobox label="Start" value={value()} onChange={change} locale="en-GB" />
    </div>
  ));
  return { input: screen.getByRole("combobox", { name: "Start" }) as HTMLInputElement, onChange, value, outer };
}

describe("TimeCombobox", () => {
  it("shows the time in the locale's format", () => {
    const { input } = renderCombobox("09:05");
    expect(input.value).toBe("09:05");
  });

  it("takes a typed time on Enter or when focus leaves", () => {
    const { input, onChange } = renderCombobox();
    fireEvent.input(input, { target: { value: "3pm" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("15:00");
    fireEvent.input(input, { target: { value: "9:30" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith("09:30");
    expect(input.value).toBe("09:30");
  });

  it("puts the time back when what was typed isn't one", () => {
    const { input, onChange } = renderCombobox();
    fireEvent.input(input, { target: { value: "lunch" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("10:00");
  });

  it("lists the day in 15-minute steps with the current time selected", () => {
    const { input } = renderCombobox("10:00");
    fireEvent.focus(input);
    const list = screen.getByRole("listbox", { name: "Start" });
    const options = Array.from(list.querySelectorAll('[role="option"]'));
    expect(options).toHaveLength(96);
    expect(options[1]).toHaveTextContent("00:15");
    expect(list.querySelector('[aria-selected="true"]')).toHaveTextContent("10:00");
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("picks a listed time with the mouse", () => {
    const { input, onChange } = renderCombobox();
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByRole("option", { name: "10:45" }));
    expect(onChange).toHaveBeenCalledWith("10:45");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("steps 15 minutes with the arrow keys", () => {
    const { input, onChange } = renderCombobox("10:00");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith("10:15");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith("09:45");
  });

  it("closes its list on Escape without closing the form", () => {
    const { input, outer } = renderCombobox();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("takes the typed time before ⌘Enter saves the form", () => {
    const { input, onChange, outer } = renderCombobox();
    fireEvent.input(input, { target: { value: "11:15" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(onChange).toHaveBeenCalledWith("11:15");
    expect(outer).toHaveBeenCalledTimes(1);
  });
});
