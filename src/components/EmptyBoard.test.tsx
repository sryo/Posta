import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { EmptyBoard, STARTER_CARDS } from "./EmptyBoard";
import { SORT_MS } from "./SortingFrame";

function renderBoard() {
  const props = { onAddCard: vi.fn(), onBrowsePresets: vi.fn(), onSearchOperators: vi.fn() };
  const { container } = render(() => <EmptyBoard {...props} />);
  return { props, slot: (name: string) => [...container.querySelectorAll(".sorting-slot")].find(s => s.textContent === name)! };
}

afterEach(() => vi.useRealTimers());

describe("EmptyBoard", () => {
  it("explains what cards are", () => {
    renderBoard();
    expect(screen.getByRole("heading", { name: "Cards are saved searches" })).toBeInTheDocument();
  });

  it("adds a starter card in one click, once its letters have dropped into its slot", async () => {
    const { props, slot } = renderBoard();
    vi.useFakeTimers();
    expect(STARTER_CARDS.map(c => c.name)).toEqual(["Inbox", "Unread", "Starred", "Today"]);
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(slot("Unread")).toHaveClass("filled");
    await vi.advanceTimersByTimeAsync(SORT_MS);
    expect(props.onAddCard).toHaveBeenCalledWith({ name: "Unread", query: "is:unread" });

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await vi.advanceTimersByTimeAsync(SORT_MS);
    expect(props.onAddCard).toHaveBeenLastCalledWith({ name: "Today", query: "calendar:today" });
  });

  it("shows a slot for each starter card, lit while its chip is pointed at or focused", () => {
    const { slot } = renderBoard();
    expect(document.querySelector(".sorting-frame")).toHaveAttribute("aria-hidden", "true");
    const starred = screen.getByRole("button", { name: "Starred" });
    fireEvent.pointerEnter(starred);
    expect(slot("Starred")).toHaveClass("lit");
    expect(slot("Inbox")).not.toHaveClass("lit");
    fireEvent.pointerLeave(starred);
    expect(slot("Starred")).not.toHaveClass("lit");
    fireEvent.focus(starred);
    expect(slot("Starred")).toHaveClass("lit");
  });

  it("links to the presets and to the search operators", () => {
    const { props } = renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Browse presets" }));
    expect(props.onBrowsePresets).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Search operators" }));
    expect(props.onSearchOperators).toHaveBeenCalledTimes(1);
  });
});
