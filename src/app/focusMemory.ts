// The row each card was left on, so coming back to the card (h, l) lands on
// it again. Kept by item id, since rows come and go above it; by position
// when it left the card.
export function createFocusMemory() {
  const left = new Map<string, { itemId: string; index: number }>();
  return {
    remember(cardId: string, itemId: string, index: number) {
      left.set(cardId, { itemId, index });
    },
    // The index to focus in the card, given its items' ids now; -1 is the
    // card itself
    recall(cardId: string, itemIds: string[]): number {
      if (itemIds.length === 0) return -1;
      const last = left.get(cardId);
      if (!last) return 0;
      const index = itemIds.indexOf(last.itemId);
      return index >= 0 ? index : Math.min(last.index, itemIds.length - 1);
    },
    forget(cardId: string) {
      left.delete(cardId);
    },
  };
}
