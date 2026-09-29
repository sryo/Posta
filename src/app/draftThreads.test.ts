import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FullMessage, Thread, ThreadGroup } from "../api/tauri";
import { discardThreadDrafts, draftToOpen, isDraftThread, prepareDraftCompose, withDraftsDiscarded, type DraftToOpen } from "./draftThreads";

const b64 = (text: string) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const message = (id: string, labels: string[], headers: Record<string, string>, body = "", extra: Partial<FullMessage> = {}): FullMessage => ({
  id, threadId: "t", labelIds: labels, snippet: body, internalDate: "0",
  payload: {
    mimeType: "text/plain",
    headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
    body: { size: body.length, data: b64(body) },
  },
  ...extra,
});

const thread = (labels: string[]): Thread => ({
  gmail_thread_id: "t", account_id: "a", subject: "s", snippet: "", last_message_date: 0,
  unread_count: 0, labels, participants: [], has_attachment: false, attachments: [], calendar_event: null,
});

describe("isDraftThread", () => {
  it("is a thread holding an unsent draft", () => {
    expect(isDraftThread(thread(["DRAFT"]))).toBe(true);
    expect(isDraftThread(thread(["INBOX", "DRAFT"]))).toBe(true);
    expect(isDraftThread(thread(["INBOX"]))).toBe(false);
  });
});

describe("draftToOpen", () => {
  it("opens a thread that is only a draft as a new email with the draft's fields", () => {
    const draft = draftToOpen({
      id: "t",
      messages: [message("d1", ["DRAFT"], { To: "ana@x.com", Cc: "bo@x.com", Subject: "Plans" }, "Hi Ana,\n\nSee you")],
    });
    expect(draft).toEqual({
      messageId: "d1",
      replyTo: null,
      fields: { to: "ana@x.com", cc: "bo@x.com", bcc: "", subject: "Plans", body: "Hi Ana,\n\nSee you" },
      attachments: [],
    });
  });

  it("opens a draft that answers a thread as a reply to the message before it", () => {
    const draft = draftToOpen({
      id: "t",
      messages: [
        message("m1", ["INBOX"], { From: "ana@x.com", Subject: "Plans" }, "Lunch?"),
        message("m2", ["SENT"], { From: "me@x.com", Subject: "Re: Plans" }, "Sure"),
        message("d1", ["DRAFT"], { To: "ana@x.com", Subject: "Re: Plans" }, "Noon works"),
      ],
    });
    expect(draft).toMatchObject({ messageId: "d1", replyTo: "m2", fields: { to: "ana@x.com", subject: "Re: Plans", body: "Noon works" } });
  });

  it("leaves a thread whose latest message was sent to the thread view", () => {
    expect(draftToOpen({
      id: "t",
      messages: [message("d1", ["DRAFT"], {}, "old"), message("m1", ["INBOX"], { From: "ana@x.com" }, "new")],
    })).toBeNull();
    expect(draftToOpen({ id: "t", messages: [] })).toBeNull();
  });

  it("lists the files attached to the draft", () => {
    const draft = draftToOpen({
      id: "t",
      messages: [message("d1", ["DRAFT"], { To: "ana@x.com" }, "", {
        payload: {
          mimeType: "multipart/mixed",
          headers: [{ name: "To", value: "ana@x.com" }],
          parts: [
            { mimeType: "text/plain", body: { size: 4, data: b64("Body") } },
            { mimeType: "application/pdf", filename: "plan.pdf", body: { size: 10, attachmentId: "att-1" } },
            { mimeType: "image/png", filename: "dot.png", body: { size: 3, data: "AAA" } },
          ],
        },
      })],
    });
    expect(draft?.fields.body).toBe("Body");
    expect(draft?.attachments).toEqual([
      { filename: "plan.pdf", mimeType: "application/pdf", attachmentId: "att-1", data: undefined },
      { filename: "dot.png", mimeType: "image/png", attachmentId: undefined, data: "AAA" },
    ]);
  });
});

describe("prepareDraftCompose", () => {
  const replyDraft = (): DraftToOpen => ({
    messageId: "d1",
    replyTo: "m1",
    fields: { to: "ana@x.com", cc: "", bcc: "", subject: "Re: Plans", body: "From Gmail" },
    attachments: [
      { filename: "plan.pdf", mimeType: "application/pdf", attachmentId: "att-1" },
      { filename: "dot.png", mimeType: "image/png", data: "AAA" },
      { filename: "gone.txt", mimeType: "text/plain", attachmentId: "att-gone" },
    ],
  });
  const deps = {
    listThreadDrafts: vi.fn(async () => [{ id: "g-other", message: { id: "d0" } }, { id: "g1", message: { id: "d1" } }]),
    download: vi.fn(async (_messageId: string, attachmentId: string) => {
      if (attachmentId === "att-gone") throw new Error("gone");
      return "UERG";
    }),
  };

  beforeEach(() => localStorage.clear());

  it("binds the compose to the Gmail draft, with the draft's text, reply target and files", async () => {
    const prepared = await prepareDraftCompose("acct", "t", replyDraft(), deps, 1000);
    expect(prepared.init).toMatchObject({
      to: "ana@x.com", subject: "Re: Plans", body: "From Gmail",
      reply: { threadId: "t", messageId: "m1" },
      draftKey: expect.stringMatching(/^draft_reply_acct_t#/),
    });
    expect(prepared.init.attachments).toEqual([
      { filename: "plan.pdf", mime_type: "application/pdf", data: "UERG" },
      { filename: "dot.png", mime_type: "image/png", data: "AAA" },
    ]);
    expect(prepared.missingAttachments).toEqual(["gone.txt"]);
    expect(deps.download).toHaveBeenCalledWith("d1", "att-1");
    expect(JSON.parse(localStorage.getItem(prepared.init.draftKey)!)).toMatchObject({ gmailDraftId: "g1", body: "From Gmail", savedAt: 1000, syncedAt: 1000, closed: true });
  });

  it("opens a new email's draft without a reply target", async () => {
    const prepared = await prepareDraftCompose("acct", "t", { ...replyDraft(), replyTo: null, attachments: [] }, deps, 1000);
    expect(prepared.init.reply).toBeUndefined();
    expect(prepared.init.draftKey).toMatch(/^draft_new_acct#/);
  });

  it("keeps text typed here that never reached Gmail, in the same local draft", async () => {
    localStorage.setItem("draft_reply_acct_t#abc", JSON.stringify({ to: "ana@x.com", cc: "", bcc: "", subject: "Re: Plans", body: "Typed offline", gmailDraftId: "g1", savedAt: 900, syncedAt: 500, closed: true }));
    const prepared = await prepareDraftCompose("acct", "t", replyDraft(), deps, 1000);
    expect(prepared.init.draftKey).toBe("draft_reply_acct_t#abc");
    expect(prepared.init.body).toBe("Typed offline");
  });

  it("takes Gmail's text over a local copy Gmail already had", async () => {
    localStorage.setItem("draft_reply_acct_t#abc", JSON.stringify({ to: "ana@x.com", cc: "", bcc: "", subject: "Re: Plans", body: "Old", gmailDraftId: "g1", savedAt: 900, syncedAt: 900, closed: true }));
    const prepared = await prepareDraftCompose("acct", "t", replyDraft(), deps, 1000);
    expect(prepared.init.draftKey).toBe("draft_reply_acct_t#abc");
    expect(prepared.init.body).toBe("From Gmail");
    expect(JSON.parse(localStorage.getItem("draft_reply_acct_t#abc")!)).toMatchObject({ body: "From Gmail", gmailDraftId: "g1" });
  });

  it("still opens the draft when Gmail's draft id can't be looked up", async () => {
    const offline = { ...deps, listThreadDrafts: vi.fn(async () => { throw new Error("offline"); }) };
    const prepared = await prepareDraftCompose("acct", "t", { ...replyDraft(), attachments: [] }, offline, 1000);
    expect(prepared.init.body).toBe("From Gmail");
    expect(JSON.parse(localStorage.getItem(prepared.init.draftKey)!).gmailDraftId).toBeUndefined();
  });
});

describe("discardThreadDrafts", () => {
  beforeEach(() => localStorage.clear());

  it("deletes every Gmail draft in the thread and the local copies saved into them", async () => {
    localStorage.setItem("draft_reply_acct_t#a", JSON.stringify({ body: "mine", gmailDraftId: "g1", savedAt: 1 }));
    localStorage.setItem("draft_reply_acct_t#b", JSON.stringify({ body: "other", gmailDraftId: "g9", savedAt: 1 }));
    const deleteDraft = vi.fn(async () => {});
    const listThreadDrafts = vi.fn(async () => [{ id: "g1", message: { id: "d1" } }, { id: "g2", message: { id: "d2" } }]);

    expect(await discardThreadDrafts("acct", "t", { listThreadDrafts, deleteDraft })).toBe(2);

    expect(listThreadDrafts).toHaveBeenCalledWith("acct", "t");
    expect(deleteDraft.mock.calls).toEqual([["acct", "g1"], ["acct", "g2"]]);
    expect(localStorage.getItem("draft_reply_acct_t#a")).toBeNull();
    expect(localStorage.getItem("draft_reply_acct_t#b")).not.toBeNull();
  });

  it("keeps the local copies when a deletion fails", async () => {
    localStorage.setItem("draft_new_acct#a", JSON.stringify({ body: "mine", gmailDraftId: "g1", savedAt: 1 }));
    const deleteDraft = vi.fn(async () => { throw new Error("offline"); });
    await expect(discardThreadDrafts("acct", "t", { listThreadDrafts: async () => [{ id: "g1", message: { id: "d1" } }], deleteDraft })).rejects.toThrow("offline");
    expect(localStorage.getItem("draft_new_acct#a")).not.toBeNull();
  });
});

describe("withDraftsDiscarded", () => {
  const groups = (t: Thread): ThreadGroup[] => [{ label: "Today", threads: [t, { ...thread(["INBOX"]), gmail_thread_id: "other" }] }];

  it("drops a thread that was only a draft", () => {
    const next = withDraftsDiscarded(groups(thread(["DRAFT"])), "t", "is:inbox");
    expect(next[0].threads.map(t => t.gmail_thread_id)).toEqual(["other"]);
  });

  it("drops a reply draft's thread from a drafts card and keeps it, without the draft, elsewhere", () => {
    const withReplyDraft = thread(["INBOX", "DRAFT"]);
    expect(withDraftsDiscarded(groups(withReplyDraft), "t", "in:drafts")[0].threads.map(t => t.gmail_thread_id)).toEqual(["other"]);
    const inbox = withDraftsDiscarded(groups(withReplyDraft), "t", "in:inbox")[0].threads;
    expect(inbox.find(t => t.gmail_thread_id === "t")?.labels).toEqual(["INBOX"]);
  });
});
