import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { ReactionButton } from "./ReactionButton";

const picker = () => document.querySelector<HTMLElement>(".emoji-picker");

describe("ReactionButton", () => {
  it("opens the picker and forwards the chosen emoji", () => {
    const onSelect = vi.fn();
    render(() => <ReactionButton onSelect={onSelect} />);

    expect(picker()).toBeNull();
    fireEvent.click(screen.getByTitle("Add reaction"));
    expect(picker()).not.toBeNull();

    const emoji = picker()!.querySelector<HTMLButtonElement>(".emoji-btn")!;
    fireEvent.click(emoji);
    expect(onSelect).toHaveBeenCalledWith(emoji.textContent);
    expect(picker()).toBeNull();
  });

  it("closes the open picker when its button is clicked again", () => {
    render(() => <ReactionButton onSelect={() => {}} />);
    const button = screen.getByTitle("Add reaction");
    fireEvent.click(button);
    expect(picker()).not.toBeNull();
    // A real click is mousedown then click; the picker closes on outside mousedown
    fireEvent.mouseDown(button);
    fireEvent.click(button);
    expect(picker()).toBeNull();
  });

  it("still closes on a mousedown elsewhere", () => {
    render(() => <ReactionButton onSelect={() => {}} />);
    fireEvent.click(screen.getByTitle("Add reaction"));
    fireEvent.mouseDown(document.body);
    expect(picker()).toBeNull();
  });

  it("floats the picker at the button, outside the message card that would squeeze or clip it", () => {
    const { container } = render(() => <ReactionButton onSelect={() => {}} />);
    const button = screen.getByTitle("Add reaction");
    button.getBoundingClientRect = () => ({ left: 300, top: 100, right: 322, bottom: 122, width: 22, height: 22, x: 300, y: 100, toJSON: () => ({}) });
    fireEvent.click(button);
    expect(picker()).toHaveClass("floating");
    expect(container.contains(picker())).toBe(false);
    expect(picker()!.style.top).toBe("130px");
    expect(picker()!.style.left).toBe("300px");
  });

  it("closes when the thread scrolls under the floating picker, but not when its own grid scrolls", () => {
    render(() => <ReactionButton onSelect={() => {}} />);
    fireEvent.click(screen.getByTitle("Add reaction"));
    fireEvent.scroll(document.querySelector(".emoji-grid-container")!);
    expect(picker()).not.toBeNull();
    fireEvent.scroll(document);
    expect(picker()).toBeNull();
  });

  it("stays closed while sending", () => {
    render(() => <ReactionButton onSelect={() => {}} sending />);
    const button = screen.getByTitle("Add reaction");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(picker()).toBeNull();
  });
});
