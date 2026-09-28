import type { Card } from "../api/tauri";

export function cardTypeForQuery(query: string): Card["card_type"] {
  return query.toLowerCase().includes("calendar:") ? "calendar" : "email";
}
