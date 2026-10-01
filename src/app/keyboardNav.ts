// Keyboard focus moves across the visible (non-collapsed) cards, in order

export interface ItemFocus {
  cardId: string;
  // -1 focuses the card itself rather than one of its items
  index: number;
}

// Where a move found the end of the way instead of a row: the last or first
// row of a card, or the first card
export interface FocusEdge {
  edge: "last" | "first" | "firstCard";
  cardId: string;
}

// j/k: the next or previous item within the card. Past either end the focus
// stays and the edge is named. Null leaves the focus where it is.
export function nextItemFocus(
  cards: { id: string; count: number }[],
  current: ItemFocus | null,
  down: boolean,
): ItemFocus | FocusEdge | null {
  if (cards.length === 0) return null;
  const cardIndex = current ? cards.findIndex(c => c.id === current.cardId) : -1;
  if (!current || cardIndex < 0) return { cardId: cards[0].id, index: down ? 0 : -1 };

  const { count } = cards[cardIndex];
  // The list may have shrunk under the focus (e.g. threads archived)
  const index = Math.min(current.index, count);
  const next = down ? index + 1 : index - 1;

  if (next >= 0 && next < count) return { cardId: current.cardId, index: next };
  return { edge: down ? "last" : "first", cardId: current.cardId };
}

// h/l: the neighbouring card; past the last card is the "add card" form,
// before the first is an edge. Null leaves everything as it is.
export function nextCardFocus(
  cardIds: string[],
  current: string | null,
  right: boolean,
  addingCard: boolean,
): { cardId: string | null; addingCard: boolean } | FocusEdge | null {
  if (cardIds.length === 0) return null;
  const last = cardIds[cardIds.length - 1];
  const cardIndex = current ? cardIds.indexOf(current) : -1;

  if (cardIndex < 0) {
    // From the add card form (or no focus), left goes to the last card
    return right ? { cardId: cardIds[0], addingCard: false } : { cardId: last, addingCard: false };
  }
  const next = cardIndex + (right ? 1 : -1);
  if (next >= 0 && next < cardIds.length) return { cardId: cardIds[next], addingCard: false };
  if (right) return { cardId: null, addingCard: true };
  return addingCard ? { cardId: last, addingCard: false } : { edge: "firstCard", cardId: cardIds[0] };
}

export function isFocusEdge(move: object): move is FocusEdge {
  return "edge" in move;
}

// The quiet line an edge shows: where the focus stopped, and the key to the
// next card when there is one
export function focusEdgeHint(
  edge: FocusEdge,
  cards: { id: string; name: string; count: number }[],
): { text: string; key?: string; next?: string } | null {
  const index = cards.findIndex(c => c.id === edge.cardId);
  if (index < 0) return null;
  const { name, count } = cards[index];
  if (edge.edge === "firstCard") return { text: `${name} is the first card` };
  if (edge.edge === "first") return { text: `First in ${name}` };
  const text = count === 0 ? `Nothing in ${name}` : `Last of ${count} in ${name}`;
  const next = cards[index + 1];
  return next ? { text, key: "l", next: next.name } : { text };
}

// What is open, as far as Escape is concerned; dialogs and the event form
// are layers (see layers.ts), which Escape closes before any of these
export interface EscapeState {
  filter: boolean;
  accountChooser: boolean;
  colorPicker: boolean;
  batchReply: boolean;
  compose: boolean;
  cardEditor: boolean;
  settings: boolean;
  actionConfigMenu: boolean;
  // Threads or events selected in the focused card
  selection: boolean;
  cardFocus: boolean;
}

// Front to back: each Escape closes the first of these that is open
const ESCAPE_ORDER: (keyof EscapeState)[] = [
  "filter", "accountChooser", "colorPicker", "batchReply", "compose",
  "cardEditor", "settings", "actionConfigMenu", "selection", "cardFocus",
];

export function escapeTarget(state: EscapeState): keyof EscapeState | null {
  return ESCAPE_ORDER.find(key => state[key]) ?? null;
}
