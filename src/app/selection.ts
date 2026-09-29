// A card's checkbox selection after clicking `clicked`. Shift adds every
// item between the pivot (the last item added by a plain click) and the
// clicked one; otherwise the click toggles the item, and adding it moves the
// pivot there.
export function nextSelection(
  orderedIds: string[],
  selected: ReadonlySet<string>,
  pivot: string | null,
  clicked: string,
  shift: boolean,
): { selected: Set<string>; pivot: string | null } {
  const next = new Set(selected);
  if (shift && pivot) {
    const from = orderedIds.indexOf(pivot);
    const to = orderedIds.indexOf(clicked);
    if (from !== -1 && to !== -1) {
      for (const id of orderedIds.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(id);
      return { selected: next, pivot };
    }
  }
  if (next.has(clicked)) {
    next.delete(clicked);
    return { selected: next, pivot };
  }
  next.add(clicked);
  return { selected: next, pivot: clicked };
}
