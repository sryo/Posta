import { safeGetItem, safeSetItem } from "../shared/storage";

// Where the thread view goes once archive, delete or spam takes the open
// thread out of its card
export type AfterArchive = "next" | "previous" | "board";

const AFTER_ARCHIVE_KEY = "afterArchive";
const AFTER_ARCHIVE_VALUES: AfterArchive[] = ["next", "previous", "board"];

export function loadAfterArchive(): AfterArchive {
  const stored = safeGetItem(AFTER_ARCHIVE_KEY);
  return AFTER_ARCHIVE_VALUES.find(v => v === stored) ?? "next";
}

export function saveAfterArchive(value: AfterArchive) {
  safeSetItem(AFTER_ARCHIVE_KEY, value);
}

// `order` is the card's threads as shown, taken before the thread left it
export function afterRemoval(order: string[], removedId: string, preference: AfterArchive): string | null {
  const i = order.indexOf(removedId);
  if (i === -1 || preference === "board") return null;
  const next = order[i + 1] ?? null;
  const previous = order[i - 1] ?? null;
  return preference === "next" ? next ?? previous : previous ?? next;
}

export function threadPosition(order: string[], id: string): { index: number; total: number } | null {
  const i = order.indexOf(id);
  return i === -1 ? null : { index: i + 1, total: order.length };
}

export function stepThread(order: string[], id: string, direction: 1 | -1): string | null {
  const i = order.indexOf(id);
  return i === -1 ? null : order[i + direction] ?? null;
}

// The row to go back to once a view opened from `from` closes: the same item
// wherever it now sits, or the one now in its place when it left the card
export function returnTo(order: string[], from: { itemId: string; index: number }): string | null {
  if (order.includes(from.itemId)) return from.itemId;
  return order[Math.min(from.index, order.length - 1)] ?? null;
}
