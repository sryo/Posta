import { describe, expect, it } from "vitest";
import type { FullMessage } from "../api/tauri";
import { batchReplyEntry, namedRecipients } from "./batchReply";
import { formatEmailDate } from "../utils";

const msg = (id: string, headers: Record<string, string>): FullMessage => ({
  id, threadId: "t", snippet: `snippet ${id}`, internalDate: "0",
  payload: { mimeType: "text/plain", headers: Object.entries(headers).map(([name, value]) => ({ name, value })), body: { size: 0 } },
} as FullMessage);

describe("batchReplyEntry", () => {
  it("answers the latest message from someone else", () => {
    const entry = batchReplyEntry("t", [
      msg("1", { From: "Ana <ana@x.com>", Subject: "Plans" }),
      msg("2", { From: "Me <me@x.com>", To: "ana@x.com", Subject: "Re: Plans" }),
    ], "ME@x.com");
    expect(entry).toMatchObject({ threadId: "t", messageId: "1", to: "ana@x.com", subject: "Plans", from: "Ana <ana@x.com>" });
  });

  it("answers at the Reply-To address", () => {
    const entry = batchReplyEntry("t", [msg("1", { From: "List <noreply@x.com>", "Reply-To": "Team <team@x.com>" })], "me@x.com");
    expect(entry?.to).toBe("team@x.com");
  });

  it("writes back to the recipients when the user sent every message", () => {
    const entry = batchReplyEntry("t", [msg("1", { From: "me@x.com", To: '"Doe, Jo" <jo@x.com>, me@x.com, bo@x.com' })], "me@x.com");
    expect(entry?.to).toBe("jo@x.com, bo@x.com");
  });

  it("dates the message as the thread view does, in words rather than digits", () => {
    const sent = Date.UTC(2025, 2, 14, 15, 30);
    const entry = batchReplyEntry("t", [{ ...msg("1", { From: "ana@x.com" }), internalDate: String(sent) }], "me@x.com");
    expect(entry?.date).toBe(formatEmailDate(new Date(sent).toISOString()));
    expect(entry?.date).not.toMatch(/\d+\/\d+\/\d+/);
  });

  it("keeps when the thread last heard a letter, a reaction or the user's own included", () => {
    const at = (ms: number) => ({ internalDate: String(ms) });
    const entry = batchReplyEntry("t", [
      { ...msg("1", { From: "ana@x.com" }), ...at(1000) },
      { ...msg("2", { From: "me@x.com" }), ...at(3000) },
    ], "me@x.com");
    expect(entry?.lastDate).toEqual(new Date(3000));
  });

  it("has nothing to answer in an empty thread", () => {

    expect(batchReplyEntry("t", [], "me@x.com")).toBeNull();
  });
});

describe("namedRecipients", () => {
  it("gives the sender's address its name, and leaves other addresses as they are", () => {
    expect(namedRecipients({ to: "ana@x.com", from: "Ana Pérez <ANA@x.com>" })).toEqual(["Ana Pérez <ANA@x.com>"]);
    expect(namedRecipients({ to: "ben@x.com, cleo@x.com", from: "Me <me@x.com>" })).toEqual(["ben@x.com", "cleo@x.com"]);
  });
});
