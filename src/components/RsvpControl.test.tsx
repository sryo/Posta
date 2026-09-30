import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { RsvpControl } from "./RsvpControl";

describe("RsvpControl", () => {
  it("offers Going, Maybe and Not going as one group", () => {
    render(() => <RsvpControl value={null} onAnswer={vi.fn()} />);
    const group = screen.getByRole("group", { name: "Your response" });
    expect(Array.from(group.querySelectorAll("button")).map(b => b.textContent)).toEqual(["Going", "Maybe", "Not going"]);
  });

  it("fills the chosen answer in its status colour with a check mark", () => {
    render(() => <RsvpControl value="tentative" onAnswer={vi.fn()} />);
    const maybe = screen.getByRole("button", { name: "Maybe" });
    expect(maybe).toHaveAttribute("aria-pressed", "true");
    expect(maybe).toHaveClass("selected", "rsvp-warning");
    expect(maybe.querySelector("svg")).not.toBeNull();
    const going = screen.getByRole("button", { name: "Going" });
    expect(going).toHaveAttribute("aria-pressed", "false");
    expect(going.querySelector("svg")).toBeNull();
  });

  it("answers with the pressed segment, and not again with the current one", () => {
    const onAnswer = vi.fn();
    render(() => <RsvpControl value="accepted" onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: "Not going" }));
    fireEvent.click(screen.getByRole("button", { name: "Going" }));
    expect(onAnswer.mock.calls).toEqual([["declined"]]);
  });

  it("can't be pressed while an answer is on its way", () => {
    const onAnswer = vi.fn();
    render(() => <RsvpControl value={null} onAnswer={onAnswer} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "Going" }));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("comes in a small and a medium size", () => {
    const { container } = render(() => <>
      <RsvpControl value={null} onAnswer={vi.fn()} size="sm" />
      <RsvpControl value={null} onAnswer={vi.fn()} />
    </>);
    const groups = container.querySelectorAll(".rsvp-control");
    expect(groups[0]).toHaveClass("rsvp-control-sm");
    expect(groups[1]).toHaveClass("rsvp-control-md");
  });

  it("shows each answer's key when asked", () => {
    render(() => <RsvpControl value={null} onAnswer={vi.fn()} showKeys />);
    expect(screen.getByRole("button", { name: "Going" })).toHaveAttribute("aria-keyshortcuts", "y");
    expect(screen.getByRole("button", { name: "Maybe" })).toHaveAttribute("aria-keyshortcuts", "Shift+M");
    expect(screen.getByRole("button", { name: "Not going" })).toHaveAttribute("aria-keyshortcuts", "n");
    expect(screen.getByRole("button", { name: "Maybe" }).querySelector(".key-hint")).toHaveTextContent("⇧M");
  });
});
