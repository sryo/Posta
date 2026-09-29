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
