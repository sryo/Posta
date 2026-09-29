// The deck renders cards with a reference-keyed <For>: a new object for a
// card tears down its column (scroll position, rows, thumbnails) and builds
// it again. These keep the objects of cards that didn't change.

// The cards with `fromId` moved to where `toId` is, or null if nothing moves
export function moveCard<T extends { id: string }>(cards: T[], fromId: string, toId: string): T[] | null {
  const from = cards.findIndex(c => c.id === fromId);
  const to = cards.findIndex(c => c.id === toId);
  if (from < 0 || to < 0 || from === to) return null;
  const moved = [...cards];
  const [card] = moved.splice(from, 1);
  moved.splice(to, 0, card);
  return moved;
}

function shallowEqual(a: object, b: object): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(key => Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

// `next`, with each card equal to one in `previous` replaced by that object
export function reuseUnchanged<T extends { id: string }>(previous: T[], next: T[]): T[] {
  const byId = new Map(previous.map(c => [c.id, c]));
  return next.map(card => {
    const old = byId.get(card.id);
    return old && shallowEqual(old, card) ? old : card;
  });
}
