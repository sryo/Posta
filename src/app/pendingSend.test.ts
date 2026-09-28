import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async (_cmd: string, _args?: Record<string, unknown>) => null);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args) }));

import { outgoingBody, sendPending, type PendingSend } from "./pendingSend";

const pending = (extra: Partial<PendingSend> = {}): PendingSend => ({
  accountId: "a", to: "bo@x.com", cc: "", bcc: "", subject: "Hi", body: "Hello", attachments: [], ...extra,
});

beforeEach(() => invoke.mockClear());

describe("outgoingBody", () => {
  it("leaves a plain-text email alone", () => {
    expect(outgoingBody({ body: "a < b\nc" })).toBe("a < b\nc");
  });

  it("escapes the text and keeps its line breaks when sending as HTML", () => {
    expect(outgoingBody({ body: "a <b>\nc & d", isHtml: true })).toBe("<div>a &lt;b&gt;<br>\nc &amp; d</div>");
  });
});

describe("sendPending", () => {
  it("sends a new email", async () => {
    await sendPending(pending({ isHtml: true, body: "x\ny" }));
    expect(invoke).toHaveBeenCalledWith("send_email", {
      accountId: "a", to: "bo@x.com", cc: "", bcc: "", subject: "Hi", body: "<div>x<br>\ny</div>", attachments: [], isHtml: true,
    });
  });

  it("sends a reply in its thread, under the message it answers", async () => {
    await sendPending(pending({ reply: { threadId: "t1", messageId: "<m1@x>" } }));
    expect(invoke).toHaveBeenCalledWith("reply_to_thread", expect.objectContaining({
      accountId: "a", threadId: "t1", messageId: "<m1@x>", body: "Hello",
    }));
    expect(invoke).not.toHaveBeenCalledWith("send_email", expect.anything());
  });

  it("lets a failed send reject so the email can be put back", async () => {
    invoke.mockRejectedValueOnce("offline");
    await expect(sendPending(pending())).rejects.toBe("offline");
  });
});
