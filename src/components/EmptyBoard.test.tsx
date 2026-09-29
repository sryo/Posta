import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { EmptyBoard, STARTER_CARDS } from "./EmptyBoard";

function renderBoard() {
  const props = { onAddCard: vi.fn(), onBrowsePresets: vi.fn(), onSearchOperators: vi.fn() };
  render(() => <EmptyBoard {...props} />);
  return props;
}

describe("EmptyBoard", () => {
  it("explains what cards are", () => {
    renderBoard();
    expect(screen.getByRole("heading", { name: "Cards are saved searches" })).toBeInTheDocument();
  });

  it("adds a starter card in one click", () => {
    const props = renderBoard();
    expect(STARTER_CARDS.map(c => c.name)).toEqual(["Inbox", "Unread", "Starred", "Today"]);
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(props.onAddCard).toHaveBeenCalledWith({ name: "Unread", query: "is:unread" });
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(props.onAddCard).toHaveBeenLastCalledWith({ name: "Today", query: "calendar:today" });
  });

  it("links to the presets and to the search operators", () => {
    const props = renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Browse presets" }));
    expect(props.onBrowsePresets).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Search operators" }));
    expect(props.onSearchOperators).toHaveBeenCalledTimes(1);
  });
});
