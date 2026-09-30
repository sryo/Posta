import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { ReactionButton } from "./ReactionButton";

const wheel = () => document.querySelector<HTMLElement>(".reaction-wheel");
const petals = () => Array.from(document.querySelectorAll<HTMLButtonElement>(".reaction-wheel .radial-petal"));
const picker = () => document.querySelector<HTMLElement>(".emoji-picker");

describe("ReactionButton", () => {
  beforeEach(() => localStorage.clear());

  it("opens a wheel of the eight reactions, each named and numbered, fire at the top", () => {
    render(() => <ReactionButton onSelect={() => {}} />);
    expect(wheel()).toBeNull();
    fireEvent.click(screen.getByTitle("Add reaction"));
    expect(petals().map(p => p.textContent)).toEqual(["🔥1", "✅2", "👌3", "🤌4", "🫡5", "👀6", "💀7", "🫶8"]);
    expect(petals()[3]).toHaveAttribute("aria-label", "Chef's kiss");
    expect(picker()).toBeNull();
  });

  it("reacts with a clicked petal and puts the wheel away", () => {
    const onSelect = vi.fn();
    render(() => <ReactionButton onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle("Add reaction"));
    fireEvent.click(petals()[0]);
    expect(onSelect).toHaveBeenCalledWith("🔥");
    expect(wheel()).toBeNull();
  });

  it("sends nothing when a press is let go over a petal, since a reaction can't be taken back", () => {
    const onSelect = vi.fn();
    render(() => <ReactionButton onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle("Add reaction"));
    const [first, second] = petals();
    const elementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => second;
    try {
      fireEvent.pointerDown(first, { button: 0 });
      fireEvent.pointerMove(document, { clientX: 1, clientY: 1 });
      fireEvent.pointerUp(document, { clientX: 1, clientY: 1 });
    } finally {
      document.elementFromPoint = elementFromPoint;
    }
    expect(onSelect).not.toHaveBeenCalled();
    expect(wheel()).not.toBeNull();
  });

  it("reacts with a petal's number, keeping the key from the thread", () => {
    const onSelect = vi.fn();
    const onThreadKey = vi.fn();
    document.addEventListener("keydown", onThreadKey);
    render(() => <ReactionButton onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle("Add reaction"));
    fireEvent.keyDown(document, { key: "3" });
    document.removeEventListener("keydown", onThreadKey);
    expect(onSelect).toHaveBeenCalledWith("👌");
    expect(onThreadKey).not.toHaveBeenCalled();
  });

  it("opens every emoji from the wheel's core, or from a typed letter as the start of a search", () => {
    const onSelect = vi.fn();
    render(() => <ReactionButton onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle("Add reaction"));
    fireEvent.click(screen.getByLabelText("Every emoji"));
    expect(wheel()).toBeNull();
    expect(picker()).not.toBeNull();
    const emoji = picker()!.querySelector<HTMLButtonElement>(".emoji-btn")!;
    fireEvent.click(emoji);
    expect(onSelect).toHaveBeenCalledWith(emoji.textContent);
    expect(picker()).toBeNull();

    fireEvent.click(screen.getByTitle("Add reaction"));
    fireEvent.keyDown(document, { key: "h" });
    expect(picker()!.querySelector<HTMLInputElement>(".emoji-search")!.value).toBe("h");
  });

  it("gives an emoji used more than a petal that petal's place, the last first, and keeps the rest where they were", () => {
    const onSelect = vi.fn();
    render(() => <ReactionButton onSelect={onSelect} />);
    const button = screen.getByTitle("Add reaction");
    for (let i = 0; i < 2; i++) {
      fireEvent.click(button);
      fireEvent.keyDown(document, { key: "h" });
      fireEvent.click(picker()!.querySelector<HTMLButtonElement>(".emoji-btn")!);
    }
    const chosen = onSelect.mock.calls[0][0];
    fireEvent.click(button);
    expect(petals().map(p => p.textContent)).toEqual(["🔥1", "✅2", "👌3", "🤌4", "🫡5", "👀6", "💀7", `${chosen}8`]);
  });

  it("pins a petal on right-click so a more used emoji takes another place, and lets it go on another", () => {
    const onSelect = vi.fn();
    render(() => <ReactionButton onSelect={onSelect} />);
    const button = screen.getByTitle("Add reaction");
    fireEvent.click(button);
    fireEvent.contextMenu(petals()[7]);
    expect(petals()[7]).toHaveAttribute("aria-label", "Love, pinned");
    expect(petals()[7]).toHaveClass("selected");
    expect(wheel()).not.toBeNull();
    fireEvent.click(button);

    for (let i = 0; i < 2; i++) {
      fireEvent.click(button);
      fireEvent.keyDown(document, { key: "h" });
      fireEvent.click(picker()!.querySelector<HTMLButtonElement>(".emoji-btn")!);
    }
    const chosen = onSelect.mock.calls[0][0];
    fireEvent.click(button);
    expect(petals().map(p => p.textContent)).toEqual(["🔥1", "✅2", "👌3", "🤌4", "🫡5", "👀6", `${chosen}7`, "🫶8"]);

    fireEvent.contextMenu(petals()[7]);
    expect(petals()[7]).toHaveAttribute("aria-label", "Love");
  });

  it("closes the wheel when its button is clicked again, or on a press elsewhere", () => {
    render(() => <ReactionButton onSelect={() => {}} />);
    const button = screen.getByTitle("Add reaction");
    fireEvent.click(button);
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(wheel()).toBeNull();
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(wheel()).toBeNull();
  });

  it("closes only the wheel on Escape", () => {
    const onThreadKey = vi.fn();
    document.addEventListener("keydown", onThreadKey);
    render(() => <ReactionButton onSelect={() => {}} />);
    fireEvent.click(screen.getByTitle("Add reaction"));
    fireEvent.keyDown(document, { key: "Escape" });
    document.removeEventListener("keydown", onThreadKey);
    expect(wheel()).toBeNull();
    expect(onThreadKey).not.toHaveBeenCalled();
  });

  it("centres the wheel on the button, outside the message card, and keeps it inside the window", () => {
    const { container } = render(() => <ReactionButton onSelect={() => {}} />);
    const button = screen.getByTitle("Add reaction");
    button.getBoundingClientRect = () => ({ left: 300, top: 100, right: 322, bottom: 122, width: 22, height: 22, x: 300, y: 100, toJSON: () => ({}) });
    fireEvent.click(button);
    expect(container.contains(wheel())).toBe(false);
    expect(wheel()!.style.left).toBe("311px");
    expect(wheel()!.style.top).toBe("111px");
    fireEvent.click(button);

    button.getBoundingClientRect = () => ({ left: 0, top: 0, right: 22, bottom: 22, width: 22, height: 22, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(button);
    expect(parseFloat(wheel()!.style.left)).toBeGreaterThan(11);
    expect(parseFloat(wheel()!.style.top)).toBeGreaterThan(11);
  });

  it("floats every emoji at the button, outside the message card that would squeeze or clip it", () => {
    const { container } = render(() => <ReactionButton onSelect={() => {}} />);
    const button = screen.getByTitle("Add reaction");
    button.getBoundingClientRect = () => ({ left: 300, top: 100, right: 322, bottom: 122, width: 22, height: 22, x: 300, y: 100, toJSON: () => ({}) });
    fireEvent.click(button);
    fireEvent.click(screen.getByLabelText("Every emoji"));
    expect(picker()).toHaveClass("floating");
    expect(container.contains(picker())).toBe(false);
    expect(picker()!.style.top).toBe("130px");
    expect(picker()!.style.left).toBe("300px");
  });

  it("closes when the thread scrolls under it, but not when the emoji grid scrolls", () => {
    render(() => <ReactionButton onSelect={() => {}} />);
    fireEvent.click(screen.getByTitle("Add reaction"));
    fireEvent.scroll(document);
    expect(wheel()).toBeNull();

    fireEvent.click(screen.getByTitle("Add reaction"));
    fireEvent.click(screen.getByLabelText("Every emoji"));
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
    expect(wheel()).toBeNull();
  });
});
