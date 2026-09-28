import { beforeAll, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render } from "@solidjs/testing-library";
import { ThreadView } from "./ThreadView";
import type { FullThread } from "../api/tauri";

const smartRepliesProps = vi.hoisted(() => ({ last: null as any }));
vi.mock("./SmartReplies", () => ({
  SmartReplies: (props: { onSelect: (text: string) => void }) => {
    smartRepliesProps.last = props;
    return <button class="reply-chip" onClick={() => props.onSelect("Sounds good")}>Sounds good</button>;
  },
}));

const b64 = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_");

const makeThread = (messages: { from: string; to?: string; cc?: string; replyTo?: string; body: string; mimeType?: string }[]): FullThread => ({
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
        ...(m.replyTo ? [{ name: "Reply-To", value: m.replyTo }] : []),
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

  it("replies to every Reply-To address and keeps them out of Cc on reply-all", () => {
    const { props } = renderThread({
      thread: makeThread([{
        from: "Bot <bot@example.com>",
        replyTo: '"Team, Support" <support@example.com>, Ops <ops@example.com>',
        to: "me@example.com, ops@example.com",
        cc: "carol@example.com",
        body: "ticket",
      }]),
      focusedMessageIndex: 0,
    });
    fireEvent.keyDown(document, { key: "R", shiftKey: true });
    const [to, cc] = (props.onReply as any).mock.calls[0];
    expect(to).toBe("support@example.com, ops@example.com");
    expect(cc).toBe("carol@example.com");
  });

  it("replies to the sender's address even when an unquoted display name has a comma", () => {
    const { props } = renderThread({
      thread: makeThread([{ from: "Doe, John <jd@example.com>", body: "hi" }]),
      focusedMessageIndex: 0,
    });
    fireEvent.keyDown(document, { key: "r" });
    expect((props.onReply as any).mock.calls[0][0]).toBe("jd@example.com");
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
    expect(document.activeElement).toBe(container.querySelector(".emoji-search"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(container.querySelector(".emoji-picker")).toBeNull();
    expect(container.querySelector(".thread-overlay.closing")).toBeNull();

    // Same when focus has left the search box (e.g. after clicking a category)
    fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".add-reaction-btn")[0]);
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector(".emoji-picker")).toBeNull();
    expect(container.querySelector(".thread-overlay.closing")).toBeNull();
  });

  it("with the label drawer open, Escape closes only the drawer and other shortcuts are ignored", () => {
    const onCloseLabelDrawer = vi.fn();
    const { props, container } = renderThread({ labelDrawerOpen: true, onCloseLabelDrawer });
    for (const key of ["a", "d", "#", "s", "u", "i", "!", "r", "f", "j", "k"]) {
      fireEvent.keyDown(document, { key });
    }
    expect(props.onAction).not.toHaveBeenCalled();
    expect(props.onReply).not.toHaveBeenCalled();
    expect(props.onForward).not.toHaveBeenCalled();
    expect(props.onFocusChange).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCloseLabelDrawer).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".thread-overlay.closing")).toBeNull();
  });

  it("toggles the label drawer shut on a second 'l'", () => {
    const onCloseLabelDrawer = vi.fn();
    const { props } = renderThread({ labelDrawerOpen: true, onCloseLabelDrawer });
    fireEvent.keyDown(document, { key: "l" });
    expect(onCloseLabelDrawer).toHaveBeenCalledTimes(1);
    expect(props.onOpenLabels).not.toHaveBeenCalled();
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

  it("names the forwarded message's recipients", () => {
    const { props } = renderThread({
      thread: makeThread([{ from: "Alice <alice@example.com>", to: "Bob <bob@example.com>", cc: "carol@example.com", body: "hi" }]),
      focusedMessageIndex: 0,
    });
    fireEvent.keyDown(document, { key: "f" });
    const body = (props.onForward as any).mock.calls[0][1];
    expect(body).toContain("Subject: Lunch\nTo: Bob <bob@example.com>\nCc: carol@example.com\n\nhi");
  });

  it("shows and quotes a plain-text body verbatim, line breaks and angle brackets included", () => {
    const { props, container } = renderThread({
      thread: makeThread([{ from: "Alice <alice@example.com>", body: "Ask Bob <bob@example.com>\nThanks" }]),
      focusedMessageIndex: 0,
    });
    const shown = container.querySelector(".message-body")!;
    expect(shown.textContent).toContain("Ask Bob <bob@example.com>\nThanks");
    expect(shown.querySelector("[style*='pre-wrap']")).not.toBeNull();
    fireEvent.keyDown(document, { key: "r" });
    expect((props.onReply as any).mock.calls[0][3]).toContain("> Ask Bob <bob@example.com>\n> Thanks");
  });

  it("does not reply while an inline compose is open", () => {
    const { props } = renderThread({
      inlineCompose: { replyToMessageId: "nope", isForward: false, onClose: vi.fn() } as any,
    });
    fireEvent.keyDown(document, { key: "r" });
    expect(props.onReply).not.toHaveBeenCalled();
  });
});

describe("ThreadView reactions", () => {
  it("shows a received reaction on the message it reacts to instead of as a message body", () => {
    const thread = makeThread([
      { from: "Alice <alice@example.com>", body: "first" },
      { from: "Bob <bob@example.com>", body: "fallback text for the reaction" },
    ]);
    thread.messages[1].reaction = {
      emoji: "🎉",
      from_addr: "bob@example.com",
      in_reply_to: "<MSG0@example.com>",
      message_id: "m1",
    };
    const { container } = renderThread({ thread });
    const cards = container.querySelectorAll(".message-card");
    expect(cards[0].querySelector(".message-reaction")?.textContent).toBe("🎉");
    expect(cards[1].textContent).not.toContain("fallback text for the reaction");
    expect(cards[1].querySelector(".message-reaction-note")?.textContent).toContain("🎉");
    expect(cards[1].querySelector(".add-reaction-btn")).toBeNull();
    expect(cards[0].querySelector(".add-reaction-btn")).not.toBeNull();
  });

  it("groups identical emojis with a count and names who reacted", () => {
    const thread = makeThread([
      { from: "Alice <alice@example.com>", body: "first" },
      { from: "Bob Stone <bob@example.com>", body: "r1" },
      { from: "carol@example.com", body: "r2" },
      { from: "Me <me@example.com>", body: "r3" },
      { from: "Bob Stone <bob@example.com>", body: "r4" },
      { from: "Dan <dan@example.com>", body: "r5" },
    ]);
    const react = (i: number, emoji: string, from_addr: string) => {
      thread.messages[i].reaction = { emoji, from_addr, in_reply_to: "<msg0@example.com>", message_id: `m${i}` };
    };
    react(1, "👍", "bob@example.com");
    react(2, "👍", "carol@example.com");
    react(3, "👍", "me@example.com");
    react(4, "👍", "bob@example.com");
    react(5, "🎉", "dan@example.com");
    const { container } = renderThread({ thread });
    const chips = Array.from(container.querySelectorAll(".message-card")[0].querySelectorAll(".message-reaction"));
    expect(chips.map(c => c.textContent)).toEqual(["👍 3", "🎉"]);
    expect(chips[0].getAttribute("title")).toBe("Bob Stone, carol@example.com, You");
    expect(chips[1].getAttribute("title")).toBe("Dan");
  });

  it("offers no reaction on the user's own messages", () => {
    const thread = makeThread([
      { from: "Alice <alice@example.com>", body: "first" },
      { from: "Me <ME@example.com>", to: "alice@example.com", body: "reply" },
    ]);
    const { container } = renderThread({ thread });
    const cards = container.querySelectorAll(".message-card");
    expect(cards[0].querySelector(".add-reaction-btn")).not.toBeNull();
    expect(cards[1].querySelector(".add-reaction-btn")).toBeNull();
  });
});

describe("ThreadView smart replies", () => {
  it("replies to the latest message from someone else, skipping reactions", () => {
    const thread = makeThread([
      { from: "Alice <alice@example.com>", body: "Lunch at noon?" },
      { from: "Bob <bob@example.com>", body: "reaction fallback" },
    ]);
    thread.messages[1].reaction = { emoji: "👍", from_addr: "bob@example.com", in_reply_to: "<msg0@example.com>", message_id: "m1" };
    const { props, container } = renderThread({ thread });
    fireEvent.click(container.querySelector(".reply-chip")!);
    const [to, , subject, body, messageId] = (props.onReply as any).mock.calls[0];
    expect(to).toBe("alice@example.com");
    expect(subject).toBe("Re: Lunch");
    expect(body.startsWith("Sounds good")).toBe(true);
    expect(body).toContain("> Lunch at noon?");
    expect(messageId).toBe("<msg0@example.com>");
  });

  it("tells suggestions which message they answer and whether a key is saved", () => {
    const [thread, setThread] = createSignal(makeThread([{ from: "Alice <alice@example.com>", body: "one" }]));
    render(() => (
      <ThreadView
        thread={thread()} loading={false} error={null} card={null} focusColor={null} onClose={vi.fn()}
        focusedMessageIndex={0} onFocusChange={vi.fn()} onOpenAttachment={vi.fn()} onDownloadAttachment={vi.fn()}
        onShowAttachmentMenu={vi.fn()} onReply={vi.fn()} onForward={vi.fn()} onAction={vi.fn()} onOpenLabels={vi.fn()}
        accountId="acc" isStarred={false} isRead={true} isImportant={false} isInInbox={true} labelCount={0} inlineCompose={null}
        geminiKeySaved={true}
      />
    ));
    const props = smartRepliesProps.last;
    expect(props.keySaved).toBe(true);
    expect(props.lastMessageId).toBe("m0");
    setThread(makeThread([{ from: "Alice <alice@example.com>", body: "one" }, { from: "Bob <bob@example.com>", body: "two" }]));
    expect(props.lastMessageId).toBe("m1");
  });
});

describe("ThreadView inline forward", () => {
  const composeStub = (isForward: boolean) => ({
    replyToMessageId: null, isForward, to: "", setTo: vi.fn(), cc: "", setCc: vi.fn(), bcc: "", setBcc: vi.fn(),
    showCcBcc: false, setShowCcBcc: vi.fn(), body: "", setBody: vi.fn(), attachments: [], onRemoveAttachment: vi.fn(),
    onFileSelect: vi.fn(), error: null, draftSaving: false, draftSaved: false, onSend: vi.fn(), onClose: vi.fn(),
    onInput: vi.fn(), focusBody: false, resizing: false, onResizeStart: vi.fn(),
  });

  const renderWithCompose = (focusedMessageIndex: number) => {
    const [compose, setCompose] = createSignal<ReturnType<typeof composeStub> | null>(null);
    const thread = makeThread([
      { from: "Alice <alice@example.com>", body: "first" },
      { from: "Bob <bob@example.com>", body: "second" },
      { from: "Carol <carol@example.com>", body: "third" },
    ]);
    const props: any = {
      thread, loading: false, error: null, card: null, focusColor: null, onClose: vi.fn(),
      focusedMessageIndex, onFocusChange: vi.fn(), onOpenAttachment: vi.fn(), onDownloadAttachment: vi.fn(),
      onShowAttachmentMenu: vi.fn(), onReply: vi.fn(), onForward: vi.fn(() => setCompose(composeStub(true))),
      onAction: vi.fn(), onOpenLabels: vi.fn(), accountId: "acc", currentUserEmail: "me@example.com",
      isStarred: false, isRead: true, isImportant: false, isInInbox: true, labelCount: 0,
    };
    const result = render(() => <ThreadView {...props} inlineCompose={compose()} />);
    return { setCompose, ...result };
  };

  const rowWithCompose = (container: HTMLElement) =>
    Array.from(container.querySelectorAll(".message-row")).findIndex(r => r.querySelector(".inline-compose"));

  it("opens the forward compose under the message being forwarded", () => {
    const { container } = renderWithCompose(0);
    fireEvent.keyDown(document, { key: "f" });
    expect(rowWithCompose(container)).toBe(0);
  });

  it("falls back to the last message for a forward started outside the thread view", () => {
    const { container, setCompose } = renderWithCompose(0);
    setCompose(composeStub(true));
    expect(rowWithCompose(container)).toBe(2);
  });
});

describe("ThreadView attachments", () => {
  it("lists a message that is itself a single attached file", () => {
    const thread = makeThread([{ from: "Alice <alice@example.com>", body: "" }]);
    thread.messages[0].payload = {
      ...thread.messages[0].payload,
      mimeType: "application/pdf",
      filename: "invoice.pdf",
      body: { attachmentId: "att-1", size: 2048 },
    };
    const { container, props } = renderThread({ thread, focusedMessageIndex: 0 });
    const thumb = container.querySelector(".attachment-thumb") as HTMLElement;
    expect(thumb).not.toBeNull();
    expect(thumb).toHaveTextContent("invoice.pdf");
    fireEvent.click(thumb);
    expect(props.onOpenAttachment).toHaveBeenCalledWith("m0", "att-1", "invoice.pdf", "application/pdf", undefined);
  });

  it("keeps same-named attachments apart when Gmail hands out fresh attachment ids", () => {
    const thread = makeThread([{ from: "Alice <alice@example.com>", body: "" }]);
    const image = (id: string) => ({ filename: "image.png", mimeType: "image/png", body: { attachmentId: id, size: 10 } });
    thread.messages[0].payload = {
      ...thread.messages[0].payload,
      mimeType: "multipart/mixed",
      parts: [{ mimeType: "text/plain", body: { data: b64("hi") } }, image("detail-1"), image("detail-2")],
    };
    const listed = (id: string, data: string) => ({
      message_id: "m0", attachment_id: id, filename: "image.png", mime_type: "image/png", size: 10, inline_data: data, content_id: null,
    });
    const { container, props } = renderThread({
      thread,
      focusedMessageIndex: 0,
      threadAttachments: [listed("list-1", "Rmlyc3Q"), listed("list-2", "U2Vjb25k")],
    });
    const thumbs = container.querySelectorAll<HTMLElement>(".attachment-thumb");
    expect(thumbs).toHaveLength(2);
    fireEvent.click(thumbs[0]);
    fireEvent.click(thumbs[1]);
    const inlineData = (props.onOpenAttachment as any).mock.calls.map((c: unknown[]) => c[4]);
    expect(inlineData).toEqual(["Rmlyc3Q", "U2Vjb25k"]);
  });

  it("pairs same-named attachments by attachment id when the ids still match", () => {
    const thread = makeThread([{ from: "Alice <alice@example.com>", body: "" }]);
    const image = (id: string) => ({ filename: "image.png", mimeType: "image/png", body: { attachmentId: id, size: 10 } });
    thread.messages[0].payload = {
      ...thread.messages[0].payload,
      mimeType: "multipart/mixed",
      parts: [{ mimeType: "text/plain", body: { data: b64("hi") } }, image("id-1"), image("id-2")],
    };
    const listed = (id: string, data: string) => ({
      message_id: "m0", attachment_id: id, filename: "image.png", mime_type: "image/png", size: 10, inline_data: data, content_id: null,
    });
    const { container, props } = renderThread({
      thread,
      focusedMessageIndex: 0,
      threadAttachments: [listed("id-2", "U2Vjb25k"), listed("id-1", "Rmlyc3Q")],
    });
    const thumbs = container.querySelectorAll<HTMLElement>(".attachment-thumb");
    fireEvent.click(thumbs[0]);
    fireEvent.click(thumbs[1]);
    const inlineData = (props.onOpenAttachment as any).mock.calls.map((c: unknown[]) => c[4]);
    expect(inlineData).toEqual(["Rmlyc3Q", "U2Vjb25k"]);
  });

  it("opens an attachment from the keyboard", () => {
    const thread = makeThread([{ from: "Alice <alice@example.com>", body: "" }]);
    thread.messages[0].payload = {
      ...thread.messages[0].payload,
      mimeType: "application/pdf",
      filename: "invoice.pdf",
      body: { attachmentId: "att-1", size: 2048 },
    };
    const { container, props } = renderThread({ thread, focusedMessageIndex: 0 });
    const thumb = container.querySelector(".attachment-thumb") as HTMLElement;
    expect(thumb.tabIndex).toBe(0);
    expect(thumb.getAttribute("role")).toBe("button");
    fireEvent.keyDown(thumb, { key: "Enter" });
    expect(props.onOpenAttachment).toHaveBeenCalledTimes(1);
  });
});

describe("ThreadView scrolling", () => {
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => r(null)));

  it("scrolls to the newest message on open but keeps the reading position when the thread refreshes", async () => {
    const messages = [
      { from: "Alice <alice@example.com>", body: "first" },
      { from: "Bob <bob@example.com>", body: "second" },
    ];
    const [thread, setThread] = createSignal(makeThread(messages));
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(() => (
      <ThreadView
        thread={thread()} loading={false} error={null} card={null} focusColor={null} onClose={vi.fn()}
        focusedMessageIndex={0} onFocusChange={vi.fn()} onOpenAttachment={vi.fn()} onDownloadAttachment={vi.fn()}
        onShowAttachmentMenu={vi.fn()} onReply={vi.fn()} onForward={vi.fn()} onAction={vi.fn()} onOpenLabels={vi.fn()}
        accountId="acc" isStarred={false} isRead={true} isImportant={false} isInInbox={true} labelCount={0} inlineCompose={null}
      />
    ));
    await nextFrame();
    expect(scroll).toHaveBeenCalledWith({ block: "start" });

    // Starring or relabelling reloads the same thread
    const cardsBefore = Array.from(document.querySelectorAll(".message-card"));
    scroll.mockClear();
    setThread(makeThread(messages));
    await nextFrame();
    expect(scroll).not.toHaveBeenCalled();
    // ...whose messages are unchanged, so their rows (and any text selection) stay
    expect(Array.from(document.querySelectorAll(".message-card"))).toEqual(cardsBefore);
    expect(cardsBefore.every(card => card.isConnected)).toBe(true);

    // A reply arriving does bring the newest message into view
    setThread(makeThread([...messages, { from: "Carol <carol@example.com>", body: "third" }]));
    await nextFrame();
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
  });

  it("jumps to the newest message again when the open thread is opened anew", async () => {
    const messages = [
      { from: "Alice <alice@example.com>", body: "first" },
      { from: "Bob <bob@example.com>", body: "second" },
    ];
    const [thread, setThread] = createSignal<FullThread | null>(makeThread(messages));
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(() => (
      <ThreadView
        thread={thread()} loading={false} error={null} card={null} focusColor={null} onClose={vi.fn()}
        focusedMessageIndex={0} onFocusChange={vi.fn()} onOpenAttachment={vi.fn()} onDownloadAttachment={vi.fn()}
        onShowAttachmentMenu={vi.fn()} onReply={vi.fn()} onForward={vi.fn()} onAction={vi.fn()} onOpenLabels={vi.fn()}
        accountId="acc" isStarred={false} isRead={true} isImportant={false} isInInbox={true} labelCount={0} inlineCompose={null}
      />
    ));
    await nextFrame();
    scroll.mockClear();
    // Opening a thread clears it while the new copy loads
    setThread(null);
    setThread(makeThread(messages));
    await nextFrame();
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
  });
});

describe("ThreadView closing", () => {
  it("closes once however often Escape is pressed during the closing animation", () => {
    vi.useFakeTimers();
    try {
      const { props } = renderThread();
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.keyDown(document, { key: "Escape" });
      vi.advanceTimersByTime(500);
      expect(props.onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not close whatever is open next once it is gone", () => {
    vi.useFakeTimers();
    try {
      const { props, unmount } = renderThread();
      fireEvent.keyDown(document, { key: "Escape" });
      unmount();
      vi.advanceTimersByTime(500);
      expect(props.onClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ThreadView load errors", () => {
  it("offers to try loading the thread again", () => {
    const onRetry = vi.fn();
    const { getByRole } = renderThread({ thread: null, error: "Couldn't load this conversation.", onRetry });
    fireEvent.click(getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("stops saying Loading once the thread failed to load", () => {
    const { queryByText } = renderThread({ thread: null, error: "Couldn't load this conversation." });
    expect(queryByText("Loading...")).toBeNull();
  });

  it("says Loading in the title bar while the thread loads", () => {
    const { getByText } = renderThread({ thread: null, loading: true });
    expect(getByText("Loading...")).toBeInTheDocument();
  });
});
