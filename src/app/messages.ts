import { extractEmail } from "../utils";

type Headers = { name: string; value: string }[] | undefined;
type MessageLike = { payload?: { headers?: Headers }; reaction?: unknown };
type ReactionLike = { id: string; payload?: { headers?: Headers }; reaction?: { in_reply_to: string } | null };

// Gmail preserves the sender's header casing ("Message-Id", "from", ...)
export function findHeader(headers: Headers, name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers?.find(h => h.name?.toLowerCase() === lower)?.value;
}

// The message a reply or reaction should target: the latest one the account
// did not send itself and that is not a reaction, or the latest one if there
// is no such message
export function lastMessageFromOthers<M extends MessageLike>(messages: M[], accountEmail: string): M | undefined {
  const self = accountEmail.toLowerCase();
  for (let i = messages.length - 1; i >= 0; i--) {
    const from = findHeader(messages[i].payload?.headers, "From");
    if (messages[i].reaction) continue;
    if (from && extractEmail(from).toLowerCase() !== self) return messages[i];
  }
  return messages[messages.length - 1];
}

export const normalizeMessageId = (id: string) => id.trim().replace(/^<|>$/g, "").toLowerCase();

// Reactions to a message in the same thread show as chips on that message,
// so their own message is left out of the conversation
export function reactionsShownAsChips(messages: ReactionLike[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) {
    const id = findHeader(m.payload?.headers, "Message-ID");
    if (id) ids.add(normalizeMessageId(id));
  }
  const shown = new Set<string>();
  for (const m of messages) {
    if (m.reaction && ids.has(normalizeMessageId(m.reaction.in_reply_to))) shown.add(m.id);
  }
  return shown;
}

// The next shown message in a direction, or `from` at either end
export function stepShownIndex(from: number, direction: 1 | -1, hidden: boolean[]): number {
  for (let i = from + direction; i >= 0 && i < hidden.length; i += direction) {
    if (!hidden[i]) return i;
  }
  return from;
}

export function nearestShownIndex(index: number, hidden: boolean[]): number {
  if (!hidden[index]) return index;
  const earlier = stepShownIndex(index, -1, hidden);
  return earlier !== index ? earlier : stepShownIndex(index, 1, hidden);
}
