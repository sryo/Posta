import { extractEmail, splitEmailList } from "../utils";
import { findHeader, nameInMessages } from "./messages";
import { isMailingList } from "./unsubscribe";

type MessageLike = { payload?: { headers?: { name: string; value: string }[] } };

// Whether the user got the message only as Bcc: it was delivered to their
// account, yet neither To nor Cc names them or an address they send from.
// Lists leave the user out of To as well, so they never count.
export function wasBcc(message: MessageLike, ownEmails: readonly string[], sentFrom: readonly string[]): boolean {
  const headers = message.payload?.headers;
  const account = new Set(ownEmails.map(e => e.toLowerCase()));
  const own = new Set([...account, ...sentFrom.map(e => e.toLowerCase())]);
  const deliveredTo = extractEmail(findHeader(headers, "Delivered-To") ?? "").trim().toLowerCase();
  if (!account.has(deliveredTo) || isMailingList(headers)) return false;
  if (own.has(extractEmail(findHeader(headers, "From") ?? "").toLowerCase())) return false;
  const named = [...splitEmailList(findHeader(headers, "To") ?? ""), ...splitEmailList(findHeader(headers, "Cc") ?? "")];
  return !named.some(address => own.has(extractEmail(address).trim().toLowerCase()));
}

// "Marta Ruiz", "Marta Ruiz and Ben Ortiz", "Marta Ruiz and 3 others"
function peopleLine(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]} and ${names.length - 1} others`;
}

// What to say under a Reply all to a message the user got as Bcc, given who
// the reply goes to; null when they weren't Bcc'd or only the sender would see it
export function bccNotice(
  message: MessageLike,
  recipients: { to: string; cc: string },
  ownEmails: readonly string[],
  sentFrom: readonly string[],
): { line: string; sender: string; only: string } | null {
  if (!wasBcc(message, ownEmails, sentFrom)) return null;
  const from = findHeader(message.payload?.headers, "From") ?? "";
  const sender = extractEmail(from);
  const others = [...splitEmailList(recipients.to), ...splitEmailList(recipients.cc)]
    .map(address => extractEmail(address).trim())
    .filter(email => email && email.toLowerCase() !== sender.toLowerCase());
  if (others.length === 0) return null;
  const name = (email: string) => nameInMessages(email, [message]) ?? email;
  const senderName = nameInMessages(sender, [message])?.split(/\s+/)[0] ?? sender;
  return {
    line: `You were Bcc'd. Reply all shows ${peopleLine(others.map(name))} that you have this.`,
    sender,
    only: `Reply to ${senderName} only`,
  };
}
