import { createSignal, For, onCleanup } from "solid-js";
import { lettersDrop, SORT_MS, SortingFrame } from "./SortingFrame";

export const STARTER_CARDS = [
  { name: "Inbox", query: "is:inbox" },
  { name: "Unread", query: "is:unread" },
  { name: "Starred", query: "is:starred" },
  { name: "Today", query: "calendar:today" },
];

// Shown on a board without cards
export function EmptyBoard(props: {
  onAddCard: (card: { name: string; query: string }) => unknown;
  onBrowsePresets: () => void;
  onSearchOperators: () => void;
}) {
  const [pointed, setPointed] = createSignal<number | null>(null);
  // The starter whose letters are dropping in, or being made into a card
  const [sorting, setSorting] = createSignal<number | null>(null);
  let dropping: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(dropping));

  function add(index: number) {
    if (sorting() !== null) return;
    setSorting(index);
    const sort = async () => {
      try {
        await props.onAddCard(STARTER_CARDS[index]);
      } finally {
        setSorting(null);
      }
    };
    if (lettersDrop()) dropping = setTimeout(sort, SORT_MS);
    else void sort();
  }

  return (
    <div class="empty-board">
      <SortingFrame
        cards={STARTER_CARDS}
        lit={(i) => pointed() === i || sorting() === i}
        filled={(i) => sorting() === i}
      />
      <h2>Cards are saved searches</h2>
      <p>Each card keeps one Gmail search or calendar view up to date. Start with one of these:</p>
      <div class="empty-board-chips">
        <For each={STARTER_CARDS}>
          {(card, i) => (
            <button
              class="empty-board-chip"
              onClick={() => add(i())}
              onPointerEnter={() => setPointed(i())}
              onPointerLeave={() => setPointed(null)}
              onFocus={() => setPointed(i())}
              onBlur={() => setPointed(null)}
              title={card.query}
            >
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
