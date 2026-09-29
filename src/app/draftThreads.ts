import type { FullMessage, FullThread, GmailDraft, MessagePart, SendAttachment, Thread, ThreadGroup } from "../api/tauri";
import { safeSetJSON } from "../shared/storage";
import { extractMessageText } from "../utils";
import { draftKey, findLatestDraft, forgetDraftsSyncedTo, sessionDraftKey, type Draft } from "./drafts";
import { findHeader } from "./messages";

const isDraft = (message: FullMessage) => !!message.labelIds?.includes("DRAFT");

export function isDraftThread(thread: Pick<Thread, "labels">): boolean {
  return thread.labels.includes("DRAFT");
}

export interface DraftAttachment {
  filename: string;
  mimeType: string;
  // One of these holds the file: an id to download it by, or its data
  attachmentId?: string;
  data?: string;
}

export interface DraftToOpen {
  // The draft message's Gmail id
  messageId: string;
  // The message the draft answers; null when it's a new email
  replyTo: string | null;
  fields: { to: string; cc: string; bcc: string; subject: string; body: string };
  attachments: DraftAttachment[];
}

function fileParts(message: FullMessage): MessagePart[] {
  const payload = message.payload;
  const found: MessagePart[] = [];
  const walk = (parts: MessagePart[] | undefined) => {
    for (const part of parts ?? []) {
      if (part.filename) found.push(part);
      walk(part.parts);
    }
  };
  if (payload?.parts?.length) walk(payload.parts);
  else if (payload?.filename) found.push(payload as MessagePart);
  return found;
}

// The draft to continue when a thread opens: its latest message, when that
// is an unsent draft. It answers the last sent or received message before
// it, if there is one.
export function draftToOpen(thread: FullThread): DraftToOpen | null {
  const latest = thread.messages[thread.messages.length - 1];
  if (!latest || !isDraft(latest)) return null;
  const replyTo = thread.messages.slice(0, -1).filter(m => !isDraft(m)).pop();
  const headers = latest.payload?.headers;
  return {
    messageId: latest.id,
    replyTo: replyTo?.id ?? null,
    fields: {
      to: findHeader(headers, "To") ?? "",
      cc: findHeader(headers, "Cc") ?? "",
      bcc: findHeader(headers, "Bcc") ?? "",
      subject: findHeader(headers, "Subject") ?? "",
      body: extractMessageText(latest.payload, latest.snippet),
    },
    attachments: fileParts(latest).map(part => ({
      filename: part.filename!,
      mimeType: part.mimeType || "application/octet-stream",
      attachmentId: part.body?.attachmentId,
      data: part.body?.data,
    })),
  };
}

export interface DraftCompose {
  init: DraftToOpen["fields"] & {
    reply?: { threadId: string; messageId: string };
    // The local draft the compose continues, bound to the Gmail draft
    draftKey: string;
    attachments: SendAttachment[];
  };
  // Files of the draft that couldn't be downloaded
  missingAttachments: string[];
}

// What a compose continuing a thread's Gmail draft opens with. The compose
// saves over the Gmail draft through a local draft that records its id; one
// already kept here for it is reused, and its text wins only when it holds
// typing Gmail never got.
export async function prepareDraftCompose(
  accountId: string,
  threadId: string,
  draft: DraftToOpen,
  deps: {
    listThreadDrafts: (accountId: string, threadId: string) => Promise<GmailDraft[]>;
    download: (messageId: string, attachmentId: string) => Promise<string>;
  },
  now: number,
): Promise<DraftCompose> {
  const reply = draft.replyTo ? { threadId, messageId: draft.replyTo } : undefined;
  const group = draftKey(accountId, { replyThreadId: reply?.threadId });

  let gmailDraftId: string | undefined;
  try {
    gmailDraftId = (await deps.listThreadDrafts(accountId, threadId)).find(d => d.message?.id === draft.messageId)?.id;
  } catch (e) {
    console.warn("Couldn't look up the Gmail draft:", e);
  }

  const attachments: (SendAttachment | undefined)[] = [];
  const missingAttachments: string[] = [];
  await Promise.all(draft.attachments.map(async (file, i) => {
    try {
      const data = file.data ?? (file.attachmentId ? await deps.download(draft.messageId, file.attachmentId) : undefined);
      if (data === undefined) throw new Error("no data");
      attachments[i] = { filename: file.filename, mime_type: file.mimeType, data };
    } catch {
      missingAttachments.push(file.filename);
    }
  }));

  const local = gmailDraftId ? findLatestDraft(group, d => d.gmailDraftId === gmailDraftId) : null;
  const unsyncedHere = !!local && (local.draft.syncedAt ?? 0) < local.draft.savedAt;
  const key = local?.key ?? sessionDraftKey(group);
  const fields = local && unsyncedHere ? pickFields(local.draft) : draft.fields;
  if (!unsyncedHere) {
    const saved: Draft = {
      ...fields,
      threadId: reply?.threadId,
      replyMessageId: reply?.messageId,
      gmailDraftId,
      savedAt: now,
      syncedAt: now,
      // Kept out of the next compose's pick until this one continues it
      closed: true,
    };
    safeSetJSON(key, saved);
  }
  return {
    init: { ...fields, reply, draftKey: key, attachments: attachments.filter((a): a is SendAttachment => !!a) },
    missingAttachments,
  };
}

function pickFields(draft: Draft): DraftToOpen["fields"] {
  return { to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, body: draft.body };
}

// Deletes the thread's drafts from Gmail and from here; resolves how many
// there were
export async function discardThreadDrafts(
  accountId: string,
  threadId: string,
  deps: {
    listThreadDrafts: (accountId: string, threadId: string) => Promise<GmailDraft[]>;
    deleteDraft: (accountId: string, draftId: string) => Promise<void>;
  },
): Promise<number> {
  const ids = (await deps.listThreadDrafts(accountId, threadId)).map(d => d.id);
  await Promise.all(ids.map(id => deps.deleteDraft(accountId, id)));
  forgetDraftsSyncedTo(ids);
  return ids.length;
}

// A card's groups once a thread's drafts are discarded: a thread that was
// only a draft is gone, and one that also has sent or received mail leaves
// only the cards that list drafts
export function withDraftsDiscarded(groups: ThreadGroup[], threadId: string, cardQuery: string): ThreadGroup[] {
  const draftsCard = /\b(in|is|label):drafts?\b/i.test(cardQuery);
  return groups.map(group => ({
    ...group,
    threads: group.threads
      .filter(t => t.gmail_thread_id !== threadId || !(draftsCard || t.labels.every(l => l === "DRAFT")))
      .map(t => (t.gmail_thread_id === threadId ? { ...t, labels: t.labels.filter(l => l !== "DRAFT") } : t)),
  }));
}
