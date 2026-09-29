import type { FullMessage, MessagePart } from "../api/tauri";
import { extractEmail, extractMessageHtml, splitEmailList } from "../utils";
import { findHeader, lastMessageFromOthers } from "./messages";

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
    date: msg.internalDate ? new Date(parseInt(msg.internalDate)).toLocaleDateString() : "",
    messageId: msg.id,
    to,
    parts: msg.payload?.parts,
  };
}
