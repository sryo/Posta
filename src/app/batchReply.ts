import type { FullMessage, MessagePart } from "../api/tauri";
import { extractEmail, extractMessageHtml, formatEmailDate, splitEmailList } from "../utils";
import { findHeader, lastMessageFromOthers, messageDate } from "./messages";
import { latestDate } from "./transit";

export interface BatchReplyThread {
  threadId: string;
  subject: string;
  snippet: string;
  body: string; // Full HTML body
  from: string;
  date: string;
  messageId: string; // Gmail id; reply_to_thread threads under it with its full References
  to: string; // Reply-to address
  parts?: MessagePart[]; // Where the body's inline images are
  accountId?: string; // The account the thread is in, which the reply is sent from
  lastDate: Date | null; // When the thread last heard a letter, whoever sent it
}

// What a batch reply to a thread shows and who it goes to: the latest
// message from someone else, answered at its Reply-To (else its sender).
// When the user wrote every message, the reply goes back to the recipients
// of the user's last one.
export function batchReplyEntry(threadId: string, messages: FullMessage[], accountEmail: string): BatchReplyThread | null {
  const msg = lastMessageFromOthers(messages, accountEmail);
  if (!msg) return null;
  const headers = msg.payload?.headers;
  const self = accountEmail.toLowerCase();
  const from = findHeader(headers, "From") || "Unknown";

  let to: string;
  if (extractEmail(from).toLowerCase() === self) {
    to = splitEmailList(findHeader(headers, "To") || "")
      .map(extractEmail)
      .filter(e => e && e.toLowerCase() !== self)
      .join(", ");
  } else {
    to = extractEmail(findHeader(headers, "Reply-To") || from);
  }

  return {
    threadId,
    subject: findHeader(headers, "Subject") || "(No subject)",
    snippet: msg.snippet || "",
    body: extractMessageHtml(msg.payload, msg.snippet),
    from,
    date: msg.internalDate ? formatEmailDate(new Date(parseInt(msg.internalDate)).toISOString()) : "",
    messageId: msg.id,
    to,
    parts: msg.payload?.parts,
    lastDate: latestDate(messages.map(messageDate)),
  };
}

// A batch reply's recipients, the sender's address carrying the sender's name
export function namedRecipients(entry: Pick<BatchReplyThread, "to" | "from">): string[] {
  const sender = extractEmail(entry.from).toLowerCase();
  return splitEmailList(entry.to).map(to => (extractEmail(to).toLowerCase() === sender ? entry.from : to));
}
