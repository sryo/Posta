import type { Card } from "../api/tauri";

// A calendar card's query starts with its calendar: range; the operator
// anywhere else is just a search word
export function cardTypeForQuery(query: string): Card["card_type"] {
  return /^calendar:/i.test(query.trimStart()) ? "calendar" : "email";
}
