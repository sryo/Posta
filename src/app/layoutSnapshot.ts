import type { Card } from "../api/tauri";
import { ALL_ACCOUNTS } from "./accountScope";

// A card layout replaced by a preset or a copied layout, kept on this Mac so
// the replacement can be undone from Settings for a while

export const SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Snapshots kept before cards named their account have no account_id
export type CardSpec = Pick<Card, "name" | "query" | "color" | "group_by" | "card_type"> & Partial<Pick<Card, "account_id">>;

export interface LayoutSnapshot {
  savedAt: number;
  cards: CardSpec[];
}

const key = (email: string) => `layoutSnapshot:${email}`;

export function cardSpecs(cards: Card[]): CardSpec[] {
  return cards.map(({ account_id, name, query, color, group_by, card_type }) => ({ account_id, name, query, color, group_by, card_type }));
}

// A newly added account's copy of another account's mail cards. Calendar
// cards and label queries name that account's own calendars and labels, so
// they stay behind.
export function copyableCards(cards: Card[], fromAccountId: string, toAccountId: string): CardSpec[] {
  return cards
    .filter(c => c.account_id === fromAccountId && c.card_type !== "calendar" && !/(^|\s|-)label:/i.test(c.query))
    .map(({ name, query, color, group_by, card_type }) => ({ account_id: toAccountId, name, query, color, group_by, card_type }));
}

// The account to put a card back in: its own while signed in (or all of
// them), else `fallback`
export function specAccountId(spec: Pick<CardSpec, "account_id">, signedIn: string[], fallback: string): string {
  const id = spec.account_id;
  return id && (id === ALL_ACCOUNTS || signedIn.includes(id)) ? id : fallback;
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
