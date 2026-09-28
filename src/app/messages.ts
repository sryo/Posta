import { extractEmail } from "../utils";

type Headers = { name: string; value: string }[] | undefined;
type MessageLike = { payload?: { headers?: Headers }; reaction?: unknown };

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
