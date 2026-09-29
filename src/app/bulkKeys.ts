// Single-key thread actions act on the card's selection when it has one,
// the way the bulk wheel's buttons do, and on the focused thread otherwise

export function keyTargets(selected: ReadonlySet<string> | undefined, focusedId: string | null): string[] {
  if (selected && selected.size > 0) return [...selected];
  return focusedId ? [focusedId] : [];
}

// The bulk wheel shows these key hints; like its buttons they set rather than
// toggle, since the selected threads may differ
const BULK_ACTIONS: Record<string, string> = {
  a: "archive",
  s: "star",
  u: "read",
  i: "important",
  d: "trash",
  "#": "trash",
  "!": "spam",
};

export function bulkActionForKey(key: string): string | null {
  return BULK_ACTIONS[key] ?? null;
}

// Shift+J/K: select the focused row and its neighbour, and focus the neighbour
export function extendSelection(
  orderedIds: string[],
  selected: ReadonlySet<string>,
  focusedIndex: number,
  down: boolean,
): { selected: Set<string>; index: number } {
  const next = new Set(selected);
  const current = orderedIds[focusedIndex];
  if (current === undefined) return { selected: next, index: focusedIndex };
  next.add(current);
  const index = focusedIndex + (down ? 1 : -1);
  const neighbour = orderedIds[index];
  if (neighbour === undefined) return { selected: next, index: focusedIndex };
  next.add(neighbour);
  return { selected: next, index };
}
