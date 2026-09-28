import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { ThreadView } from "./ThreadView";
import type { FullThread } from "../api/tauri";

const b64 = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_");

const makeThread = (messages: { from: string; to?: string; cc?: string; body: string; mimeType?: string }[]): FullThread => ({
  id: "t1",
  messages: messages.map((m, i) => ({
    id: `m${i}`,
    threadId: "t1",
    payload: {
      mimeType: m.mimeType ?? "text/plain",
      headers: [
        { name: "From", value: m.from },
        { name: "To", value: m.to ?? "me@example.com" },
        ...(m.cc ? [{ name: "Cc", value: m.cc }] : []),
        { name: "Subject", value: "Lunch" },
        { name: "Date", value: "Mon, 1 Jan 2024 10:00:00 +0000" },
        { name: "Message-ID", value: `<msg${i}@example.com>` },
      ],
      body: { data: b64(m.body) },
    },
  })),
});

function renderThread(overrides: Partial<Parameters<typeof ThreadView>[0]> = {}) {
  const props = {
    thread: makeThread([
      { from: "Alice <alice@example.com>", body: "first" },
      { from: "Bob <bob@example.com>", cc: "carol@example.com", body: "second" },
    ]),
    loading: false,
    error: null,
    card: null,
    focusColor: null,
    onClose: vi.fn(),
    focusedMessageIndex: 1,
    onFocusChange: vi.fn(),
    onOpenAttachment: vi.fn(),
    onDownloadAttachment: vi.fn(),
    onShowAttachmentMenu: vi.fn(),
    onReply: vi.fn(),
    onForward: vi.fn(),
    onAction: vi.fn(),
    onOpenLabels: vi.fn(),
    accountId: "acc",
    currentUserEmail: "me@example.com",
    isStarred: false,
    isRead: true,
    isImportant: false,
    isInInbox: true,
    labelCount: 0,
    inlineCompose: null,
    ...overrides,
  };
  const result = render(() => <ThreadView {...props} />);
  return { props, ...result };
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("ThreadView keyboard shortcuts", () => {
  it("archives on a bare 'a'", () => {
    const { props } = renderThread();
    fireEvent.keyDown(document, { key: "a" });
    expect(props.onAction).toHaveBeenCalledWith("archive");
  });

  it("ignores Cmd/Ctrl/Alt combos such as Cmd+A select-all", () => {
    const { props } = renderThread();
    fireEvent.keyDown(document, { key: "a", metaKey: true });
    fireEvent.keyDown(document, { key: "d", ctrlKey: true });
    fireEvent.keyDown(document, { key: "s", altKey: true });
    fireEvent.keyDown(document, { key: "l", metaKey: true });
    expect(props.onAction).not.toHaveBeenCalled();
    expect(props.onOpenLabels).not.toHaveBeenCalled();
  });

  it("ignores keys typed into a contenteditable element", () => {
    const { props } = renderThread();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);
    editable.focus();
    fireEvent.keyDown(editable, { key: "a" });
    expect(props.onAction).not.toHaveBeenCalled();
    editable.remove();
  });

  it("replies to the focused message on 'r'", () => {
    const { props } = renderThread();
    fireEvent.keyDown(document, { key: "r" });
    expect(props.onReply).toHaveBeenCalledTimes(1);
    const [to, cc, subject, , messageId] = (props.onReply as any).mock.calls[0];
    expect(to).toBe("bob@example.com");
    expect(cc).toBe("");
    expect(subject).toBe("Re: Lunch");
    expect(messageId).toBe("<msg1@example.com>");
  });

  it("replies to all on Shift+R, excluding the current user", () => {
    const { props } = renderThread();
    fireEvent.keyDown(document, { key: "R", shiftKey: true });
    expect(props.onReply).toHaveBeenCalledTimes(1);
    const [to, cc] = (props.onReply as any).mock.calls[0];
    expect(to).toBe("bob@example.com");
    expect(cc).toBe("carol@example.com");
  });

  it("replies to the original recipients when the message was sent by the current user", () => {
    const { props } = renderThread({
      thread: makeThread([
        { from: "Me <ME@example.com>", to: "Dan <dan@example.com>, eve@example.com", cc: "fay@example.com, me@example.com", body: "ping" },
      ]),
      focusedMessageIndex: 0,
    });
    fireEvent.keyDown(document, { key: "r" });
    fireEvent.keyDown(document, { key: "R", shiftKey: true });
    const [replyTo, replyCc] = (props.onReply as any).mock.calls[0];
    expect(replyTo).toBe("dan@example.com, eve@example.com");
    expect(replyCc).toBe("");
    const [allTo, allCc] = (props.onReply as any).mock.calls[1];
    expect(allTo).toBe("dan@example.com, eve@example.com");
    expect(allCc).toBe("fay@example.com");
  });

  it("lists each reply-all recipient once", () => {
    const { props } = renderThread({
      thread: makeThread([
        { from: "Bob <bob@example.com>", to: "me@example.com, carol@example.com", cc: "Carol <CAROL@example.com>", body: "x" },
      ]),
      focusedMessageIndex: 0,
    });
    fireEvent.keyDown(document, { key: "R", shiftKey: true });
    expect((props.onReply as any).mock.calls[0][1]).toBe("carol@example.com");
  });

  it("closes only the emoji picker on Escape", () => {
    const { container } = renderThread();
    fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".add-reaction-btn")[0]);
    expect(container.querySelector(".emoji-picker")).not.toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(container.querySelector(".emoji-picker")).toBeNull();
    expect(container.querySelector(".thread-overlay.closing")).toBeNull();

    // Same when focus has left the search box (e.g. after clicking a category)
    fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".add-reaction-btn")[0]);
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector(".emoji-picker")).toBeNull();
    expect(container.querySelector(".thread-overlay.closing")).toBeNull();
  });

  it("forwards the focused message on 'f'", () => {
    const { props } = renderThread({ focusedMessageIndex: 0 });
    fireEvent.keyDown(document, { key: "f" });
    expect(props.onForward).toHaveBeenCalledTimes(1);
    const [subject, body] = (props.onForward as any).mock.calls[0];
    expect(subject).toBe("Fwd: Lunch");
    expect(body).toContain("From: Alice <alice@example.com>");
    expect(body).toContain("first");
  });

  it("does not reply while an inline compose is open", () => {
    const { props } = renderThread({
      inlineCompose: { replyToMessageId: "nope", isForward: false, onClose: vi.fn() } as any,
    });
    fireEvent.keyDown(document, { key: "r" });
    expect(props.onReply).not.toHaveBeenCalled();
  });
});
