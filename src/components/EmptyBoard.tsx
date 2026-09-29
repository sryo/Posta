import { For } from "solid-js";

export const STARTER_CARDS = [
  { name: "Inbox", query: "is:inbox" },
  { name: "Unread", query: "is:unread" },
  { name: "Starred", query: "is:starred" },
  { name: "Today", query: "calendar:today" },
];

// Shown on a board without cards
export function EmptyBoard(props: {
  onAddCard: (card: { name: string; query: string }) => void;
  onBrowsePresets: () => void;
  onSearchOperators: () => void;
}) {
  return (
    <div class="empty-board">
      <h2>Cards are saved searches</h2>
      <p>Each card keeps one Gmail search or calendar view up to date. Start with one of these:</p>
      <div class="empty-board-chips">
        <For each={STARTER_CARDS}>
          {(card) => (
            <button class="empty-board-chip" onClick={() => props.onAddCard(card)} title={card.query}>
              {card.name}
            </button>
          )}
        </For>
      </div>
      <div class="empty-board-links">
        <button class="link-btn" onClick={() => props.onBrowsePresets()}>Browse presets</button>
        <button class="link-btn" onClick={() => props.onSearchOperators()}>Search operators</button>
      </div>
    </div>
  );
}
