import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { ReactionButton } from "./ReactionButton";

describe("ReactionButton", () => {
  it("opens the picker and forwards the chosen emoji", () => {
    const onSelect = vi.fn();
    const { container } = render(() => <ReactionButton onSelect={onSelect} />);

    expect(container.querySelector(".emoji-picker")).toBeNull();
    fireEvent.click(screen.getByTitle("Add reaction"));
    const picker = container.querySelector(".emoji-picker");
    expect(picker).not.toBeNull();

    const emoji = picker!.querySelector<HTMLButtonElement>(".emoji-btn")!;
    fireEvent.click(emoji);
    expect(onSelect).toHaveBeenCalledWith(emoji.textContent);
    expect(container.querySelector(".emoji-picker")).toBeNull();
  });

  it("closes the open picker when its button is clicked again", () => {
    const { container } = render(() => <ReactionButton onSelect={() => {}} />);
    const button = screen.getByTitle("Add reaction");
    fireEvent.click(button);
    expect(container.querySelector(".emoji-picker")).not.toBeNull();
    // A real click is mousedown then click; the picker closes on outside mousedown
    fireEvent.mouseDown(button);
    fireEvent.click(button);
    expect(container.querySelector(".emoji-picker")).toBeNull();
  });

  it("still closes on a mousedown elsewhere", () => {
    const { container } = render(() => <ReactionButton onSelect={() => {}} />);
    fireEvent.click(screen.getByTitle("Add reaction"));
    fireEvent.mouseDown(document.body);
    expect(container.querySelector(".emoji-picker")).toBeNull();
  });

  it("stays closed while sending", () => {
    const { container } = render(() => <ReactionButton onSelect={() => {}} sending />);
    const button = screen.getByTitle("Add reaction");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(container.querySelector(".emoji-picker")).toBeNull();
  });
});
