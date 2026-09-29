import { replyToThread, sendEmail, type SendAttachment } from "../api/tauri";
import { escapeHtml } from "../utils";

// An email queued behind the undo window, captured when Send was pressed
export interface PendingSend {
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  attachments: SendAttachment[];
  reply?: { threadId: string; messageId?: string };
  // Goes out as a new email; kept so an undone forward reopens as one
  forward?: { threadId: string; subject: string; body: string };
  isHtml?: boolean;
  // The compose's saved draft, kept until the send goes out
  draft?: { key: string; gmailDraftId?: string };
}

// Compose is plain text; "send as HTML" only changes how it goes out
export function outgoingBody(pending: Pick<PendingSend, "body" | "isHtml">): string {
  if (!pending.isHtml) return pending.body;
  return `<div>${escapeHtml(pending.body).replace(/\n/g, "<br>\n")}</div>`;
}

export async function sendPending(pending: PendingSend): Promise<void> {
  const body = outgoingBody(pending);
  if (pending.reply) {
    await replyToThread(
      pending.accountId,
      pending.reply.threadId,
      pending.to,
      pending.cc,
      pending.bcc,
      pending.subject,
      body,
      pending.reply.messageId,
      pending.attachments,
      pending.isHtml,
    );
  } else {
    await sendEmail(pending.accountId, pending.to, pending.cc, pending.bcc, pending.subject, body, pending.attachments, pending.isHtml);
  }
}
