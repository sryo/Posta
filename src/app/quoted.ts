const MAX = 32;

// A subject or title as a toast names it: “Venue for the offsite”; null when
// there is none to name
export function quoted(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return `“${trimmed.length > MAX ? `${trimmed.slice(0, MAX - 1).trimEnd()}…` : trimmed}”`;
}

export function eventName(event: { title: string }): string {
  return quoted(event.title) ?? "the event";
}
