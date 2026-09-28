import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";

type Handler = (args: Record<string, unknown>) => unknown;
const handlers: Record<string, Handler> = {};
const invoke = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
  const handler = handlers[cmd];
  if (!handler) throw new Error(`unmocked command ${cmd}`);
  return handler(args);
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setBadgeCount: async () => {}, startDragging: async () => {} }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));
type MenuItemOptions = { text?: string; enabled?: boolean; action?: () => void };
let lastMenu: MenuItemOptions[] = [];
vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: async ({ items }: { items: MenuItemOptions[] }) => ({ popup: async () => { lastMenu = items; } }) },
  MenuItem: { new: async (opts: MenuItemOptions) => opts },
  PredefinedMenuItem: { new: async () => ({}) },
}));

import App from "./App";
import type { Account, Card, Thread } from "./api/tauri";

const account = (id: string, email: string): Account => ({ id, email, picture: null, signature: null });
const card = (id: string, accountId: string, name: string): Card => ({
  id, account_id: accountId, name, query: "is:inbox", position: 0, collapsed: false,
  color: null, group_by: "date", card_type: "email",
});
const thread = (id: string, subject: string): Thread => ({
  gmail_thread_id: id, account_id: "", subject, snippet: "", last_message_date: 0,
  unread_count: 0, labels: [], participants: [], has_attachment: false, attachments: [], calendar_event: null,
});

const cardsByAccount: Record<string, Card[]> = {};
const threadsByCard: Record<string, Thread[]> = {};

beforeEach(() => {
  localStorage.clear();
  invoke.mockClear();
  for (const k of Object.keys(handlers)) delete handlers[k];
  Object.assign(handlers, {
    init_app: () => null,
    get_stored_credentials: () => ({ client_id: "id", client_secret: "secret" }),
    configure_auth: () => null,
    pull_from_icloud: () => false,
    get_accounts: () => [account("a", "a@x.com")],
    get_cards: ({ accountId }) => cardsByAccount[accountId as string] ?? [],
    get_cached_card_threads: () => null,
    save_cached_card_threads: () => null,
    fetch_threads_paginated: ({ cardId }) => ({
      groups: [{ label: "Today", threads: threadsByCard[cardId as string] ?? [] }],
      next_page_token: null,
      has_more: false,
    }),
    sync_threads_incremental: () => ({ modified_threads: [], deleted_thread_ids: [], is_full_sync: false }),
    fetch_contacts: () => [],
  } satisfies Record<string, Handler>);
  cardsByAccount.a = [card("card-a", "a", "Alpha")];
  cardsByAccount.b = [card("card-b", "b", "Beta")];
  threadsByCard["card-a"] = [thread("t-a", "Mail for A")];
  threadsByCard["card-b"] = [thread("t-b", "Mail for B")];
});

afterEach(() => vi.useRealTimers());
Element.prototype.scrollIntoView = () => {};

describe("App background sync", () => {
  it("drops a thread that no longer matches its card after a change elsewhere", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");

    // Archived on another device: history reports it modified, and the
    // card's query no longer returns it
    handlers.sync_threads_incremental = () => ({
      modified_threads: [{ ...thread("t-a", "Mail for A"), labels: [] }],
      deleted_thread_ids: [],
      is_full_sync: false,
    });
    threadsByCard["card-a"] = [];
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(screen.queryByText("Mail for A")).not.toBeInTheDocument());
  });
});

describe("App attachments", () => {
  it("forwards an attachment from its context menu in a new email", async () => {
    threadsByCard["card-a"] = [{
      ...thread("t-a", "Mail for A"),
      has_attachment: true,
      attachments: [{
        message_id: "m1", attachment_id: "att1", filename: "report.pdf",
        mime_type: "application/pdf", size: 10, inline_data: null, content_id: null,
      }],
    }];
    handlers.download_attachment = ({ attachmentId }) => (attachmentId === "att1" ? "cGRm" : null);
    render(() => <App />);

    fireEvent.contextMenu(await screen.findByTitle("report.pdf (10 B)"));
    await waitFor(() => expect(lastMenu.some(i => i.text === "Forward")).toBe(true));
    const forward = lastMenu.find(i => i.text === "Forward")!;
    expect(forward.enabled).not.toBe(false);
    forward.action!();

    const compose = await waitFor(() => {
      const panel = document.querySelector(".compose-panel");
      expect(panel).not.toBeNull();
      return panel as HTMLElement;
    });
    await waitFor(() => expect(compose).toHaveTextContent("report.pdf"));
  });
});

describe("App presets", () => {
  function signInToEmptyLayout() {
    handlers.get_accounts = () => [];
    handlers.run_oauth_flow = () => account("n", "n@x.com");
    cardsByAccount.n = [];
    let nextId = 0;
    handlers.create_card = ({ name, query }) => ({
      ...card(`new-${nextId++}`, "n", name as string),
      query: query as string,
      card_type: (query as string).includes("calendar:") ? "calendar" : "email",
    });
    handlers.get_cached_card_events = () => null;
    handlers.fetch_calendar_events = () => [];
    handlers.save_cached_card_events = () => null;
    render(() => <App />);
  }

  it("creates the preset's cards once even when clicked twice", async () => {
    signInToEmptyLayout();
    fireEvent.click(await screen.findByText("Sign in with Google"));
    const option = (await screen.findByText("Traditional", {}, { timeout: 3000 })).closest(".preset-option")!;

    fireEvent.click(option);
    fireEvent.click(option);

    await waitFor(() => expect(screen.queryByText("How do you email?")).not.toBeInTheDocument());
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "create_card")).toHaveLength(4);
  });

  it("shows the cards that were created when a later one fails", async () => {
    signInToEmptyLayout();
    const create = handlers.create_card;
    let calls = 0;
    handlers.create_card = (args) => {
      if (++calls === 3) throw new Error("db locked");
      return create(args);
    };
    fireEvent.click(await screen.findByText("Sign in with Google"));
    fireEvent.click((await screen.findByText("Traditional", {}, { timeout: 3000 })).closest(".preset-option")!);

    expect(await screen.findByRole("region", { name: "Inbox email card" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Starred email card" })).toBeInTheDocument();
  });

  it("stays on the preset picker when no card could be created", async () => {
    signInToEmptyLayout();
    handlers.create_card = () => { throw new Error("db locked"); };
    fireEvent.click(await screen.findByText("Sign in with Google"));
    fireEvent.click((await screen.findByText("Traditional", {}, { timeout: 3000 })).closest(".preset-option")!);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("create_card", expect.anything()));
    await new Promise(r => setTimeout(r, 50));
    expect(screen.getByText("How do you email?")).toBeInTheDocument();
  });
});

describe("App grouping", () => {
  it("groups a card by label names once the label list loads", async () => {
    cardsByAccount.a = [{ ...card("card-a", "a", "Alpha"), group_by: "label" }];
    threadsByCard["card-a"] = [{ ...thread("t-a", "Mail for A"), labels: ["INBOX", "IMPORTANT", "Label_7"] }];
    handlers.list_labels = () => [
      { id: "Label_7", name: "Receipts", messageListVisibility: null, labelListVisibility: null, label_type: "user" },
    ];
    render(() => <App />);

    expect(await screen.findByText("Receipts")).toBeInTheDocument();
    expect(screen.queryByText("Label_7")).not.toBeInTheDocument();
  });
});

describe("App accounts", () => {
  it("loads the first account's cards and threads on start", async () => {
    render(() => <App />);
    expect(await screen.findByText("Mail for A")).toBeInTheDocument();
  });

  it("loads the new account's threads after adding an account", async () => {
    handlers.run_oauth_flow = () => account("b", "b@x.com");
    render(() => <App />);
    await screen.findByText("Mail for A");

    fireEvent.click(screen.getByTitle("a@x.com"));
    fireEvent.click(await screen.findByText("Add account"));

    expect(await screen.findByText("Mail for B")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Mail for A")).not.toBeInTheDocument());
  });

  it("collapsing a card keeps other accounts' collapsed cards", async () => {
    localStorage.setItem("collapsedCards", JSON.stringify({ "card-b": true }));
    render(() => <App />);
    await screen.findByText("Mail for A");

    fireEvent.click(screen.getByText("Alpha"));

    await waitFor(() => expect(JSON.parse(localStorage.getItem("collapsedCards")!)).toEqual({ "card-a": true, "card-b": true }));
  });

  it("signing out keeps the remaining account's collapsed cards collapsed", async () => {
    handlers.get_accounts = () => [account("a", "a@x.com"), account("b", "b@x.com")];
    handlers.delete_account = () => null;
    localStorage.setItem("collapsedCards", JSON.stringify({ "card-b": true }));
    render(() => <App />);
    await screen.findByText("Mail for A");

    fireEvent.click(screen.getByText("Sign out"));

    const betaCard = await screen.findByRole("region", { name: "Beta email card" });
    expect(betaCard).toHaveClass("collapsed");
    expect(invoke).not.toHaveBeenCalledWith("fetch_threads_paginated", expect.objectContaining({ cardId: "card-b" }));
  });
});

describe("App thread list shortcuts", () => {
  it("reports the focused thread as spam on !", async () => {
    handlers.modify_threads = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "!", shiftKey: true });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("modify_threads", expect.objectContaining({
        threadIds: ["t-a"], addLabels: expect.arrayContaining(["SPAM"]),
      })),
    );
  });

  it("clears the selection on Escape before dropping card focus", async () => {
    render(() => <App />);
    const row = (await screen.findByText("Mail for A")).closest(".thread")!;
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "x" });
    await waitFor(() => expect(row).toHaveClass("selected"));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(row).not.toHaveClass("selected"));
    expect(row).toHaveClass("focused");
  });
});

const fullMessage = (id: string, from: string, extra: Record<string, unknown> = {}) => ({
  id, threadId: "t-a", labelIds: ["INBOX"], snippet: `body ${id}`, internalDate: "0",
  payload: { mimeType: "text/plain", headers: [{ name: "From", value: from }, { name: "Subject", value: "Hi" }], body: { size: 0 } },
  ...extra,
});

describe("App thread view", () => {
  it("marks an unread thread read on open without an undo toast", async () => {
    threadsByCard["card-a"] = [{ ...thread("t-a", "Mail for A"), unread_count: 1, labels: ["INBOX", "UNREAD"] }];
    handlers.modify_threads = () => null;
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    render(() => <App />);

    fireEvent.click(await screen.findByText("Mail for A"));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("modify_threads", expect.objectContaining({
        threadIds: ["t-a"], removeLabels: ["UNREAD"],
      })),
    );
    await new Promise(r => setTimeout(r, 20));
    expect(document.querySelector(".toast-undo-btn")).toBeNull();
    expect(screen.queryByText(/Marked 1 thread as read/)).not.toBeInTheDocument();
  });
});

describe("App compose", () => {
  it("sends from the account compose was opened in after switching accounts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    handlers.get_accounts = () => [account("a", "a@x.com"), account("b", "b@x.com")];
    handlers.send_email = () => null;
    handlers.save_draft = () => ({ id: "d1" });
    handlers.delete_draft = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");

    fireEvent.click(screen.getByTitle("Compose"));
    fireEvent.input(await screen.findByPlaceholderText("Recipients"), { target: { value: "bo@y.com" } });
    fireEvent.input(screen.getByPlaceholderText("Subject"), { target: { value: "Hello" } });

    fireEvent.click(screen.getByTitle("a@x.com"));
    fireEvent.click(await screen.findByText("b@x.com"));
    await screen.findByText("Mail for B");

    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));
    await vi.advanceTimersByTimeAsync(6000);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("send_email", expect.anything()));
    expect(invoke).toHaveBeenCalledWith("send_email", expect.objectContaining({ accountId: "a", to: "bo@y.com" }));
  });
});

describe("App batch reply", () => {
  it("ignores a slow batch that finishes after another batch opened", async () => {
    cardsByAccount.a = [card("card-a", "a", "Alpha"), { ...card("card-b", "a", "Beta"), position: 1 }];
    threadsByCard["card-b"] = [thread("t-b", "Mail for B")];
    let releaseA!: () => void;
    const slowA = new Promise<void>(r => { releaseA = r; });
    handlers.get_thread_details = async ({ threadId }) => {
      if (threadId === "t-a") await slowA;
      const subject = threadId === "t-a" ? "Batch subject A" : "Batch subject B";
      return {
        id: threadId,
        messages: [{
          ...fullMessage(`m-${threadId}`, "Ana <ana@x.com>"),
          payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Ana <ana@x.com>" }, { name: "Subject", value: subject }], body: { size: 0 } },
        }],
      };
    };
    render(() => <App />);
    await screen.findByText("Mail for B");

    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.click(await screen.findByTitle("Batch Reply"));
    await screen.findByText("Loading threads...");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Loading threads...")).not.toBeInTheDocument());

    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.click(await screen.findByTitle("Batch Reply"));
    expect(await screen.findByText("Batch subject B")).toBeInTheDocument();

    releaseA();
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText("Batch subject A")).not.toBeInTheDocument();
    expect(screen.getByText("Batch subject B")).toBeInTheDocument();
  });
});
