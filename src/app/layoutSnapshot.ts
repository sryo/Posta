import type { Card } from "../api/tauri";

// A card layout replaced by a preset or a copied layout, kept on this Mac so
// the replacement can be undone from Settings for a while

export const SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type CardSpec = Pick<Card, "name" | "query" | "color" | "group_by" | "card_type">;

export interface LayoutSnapshot {
  savedAt: number;
  cards: CardSpec[];
}

const key = (email: string) => `layoutSnapshot:${email}`;

export function cardSpecs(cards: Card[]): CardSpec[] {
  return cards.map(({ name, query, color, group_by, card_type }) => ({ name, query, color, group_by, card_type }));
}

export function saveLayoutSnapshot(email: string, cards: CardSpec[], now: number) {
  if (cards.length === 0) return;
  try {
    localStorage.setItem(key(email), JSON.stringify({ savedAt: now, cards } satisfies LayoutSnapshot));
  } catch (e) {
    console.warn("Couldn't keep the replaced layout:", e);
  }
}

export function loadLayoutSnapshot(email: string, now: number): LayoutSnapshot | null {
  let snapshot: LayoutSnapshot;
  try {
    const raw = localStorage.getItem(key(email));
    if (!raw) return null;
    snapshot = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(snapshot?.cards) || typeof snapshot.savedAt !== "number") return null;
  if (now - snapshot.savedAt > SNAPSHOT_TTL_MS) {
    clearLayoutSnapshot(email);
    return null;
  }
  return snapshot;
}

export function clearLayoutSnapshot(email: string) {
  try {
    localStorage.removeItem(key(email));
  } catch {
    // Nothing to clear without storage
  }
}
