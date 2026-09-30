import type { Card } from "../api/tauri";
import { ALL_ACCOUNTS } from "./accountScope";
import { cardTypeForQuery } from "./cardType";
import { describeQuery } from "./queryTokens";

// The card a search shows its results in until it is kept or closed. It is
// never stored, so its id can't collide with a stored card's uuid.
export const SEARCH_CARD_ID = "search";

export const isSearchCard = (id: string | null | undefined) => id === SEARCH_CARD_ID;

// A search runs across every account
export function searchCard(query: string): Card {
  const q = query.trim();
  return {
    id: SEARCH_CARD_ID,
    account_id: ALL_ACCOUNTS,
    name: q,
    query: q,
    position: -1,
    collapsed: false,
    color: null,
    group_by: "date",
    card_type: cardTypeForQuery(q),
  };
}

const NAME_MAX = 40;

// The name a kept search starts with: its plain reading without the leading
// "Emails", else the query itself
export function keptCardName(query: string): string {
  const described = describeQuery(query)?.replace(/^Emails /, "");
  const name = described ? described.charAt(0).toUpperCase() + described.slice(1) : query.trim();
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1).trimEnd()}…` : name;
}

export const RECENT_SEARCHES_MAX = 8;

// `query` first, without an earlier copy of it
export function rememberSearch(recent: string[], query: string): string[] {
  const q = query.trim();
  if (!q) return recent;
  return [q, ...recent.filter(r => r !== q)].slice(0, RECENT_SEARCHES_MAX);
}

export function parseRecentSearches(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === "string" && q.trim() !== "").slice(0, RECENT_SEARCHES_MAX) : [];
  } catch {
    return [];
  }
}
