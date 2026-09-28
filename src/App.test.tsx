import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";

type Handler = (args: Record<string, unknown>) => unknown;
const handlers: Record<string, Handler> = {};
const invoke = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
  const handler = handlers[cmd];
  if (!handler) throw new Error(`unmocked command ${cmd}`);
  return handler(args);
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args) }));
const setBadgeCount = vi.fn(async (_count?: number) => {});
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setBadgeCount: (count?: number) => setBadgeCount(count), startDragging: async () => {} }),
}));
const eventListeners: Record<string, (event: { payload: unknown }) => void> = {};
const listenedEvents: string[] = [];
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    listenedEvents.push(name);
    eventListeners[name] = handler;
    return () => {};
  },
}));
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
  lastMenu = [];
  invoke.mockClear();
  setBadgeCount.mockClear();
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
    take_pending_mailtos: () => [],
    has_gemini_api_key: () => false,
  } satisfies Record<string, Handler>);
  cardsByAccount.a = [card("card-a", "a", "Alpha")];
  cardsByAccount.b = [card("card-b", "b", "Beta")];
  threadsByCard["card-a"] = [thread("t-a", "Mail for A")];
  threadsByCard["card-b"] = [thread("t-b", "Mail for B")];
});

afterEach(() => {
  vi.useRealTimers();
  // jsdom has no layout, so no scrollIntoView
  Element.prototype.scrollIntoView = () => {};
});
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

describe("App background sync deletions", () => {
  it("drops a thread deleted elsewhere from the card's saved cache", async () => {
    threadsByCard["card-a"] = [thread("t-a", "Mail for A"), thread("t-b", "Other mail")];
    render(() => <App />);
    await screen.findByText("Mail for A");
    await new Promise(r => setTimeout(r, 20));
    invoke.mockClear();

    handlers.sync_threads_incremental = () => ({ modified_threads: [], deleted_thread_ids: ["t-a"], is_full_sync: false });
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(screen.queryByText("Mail for A")).not.toBeInTheDocument());
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_cached_card_threads", expect.objectContaining({
      cardId: "card-a",
      groups: [expect.objectContaining({ threads: [expect.objectContaining({ gmail_thread_id: "t-b" })] })],
    })));
  });
});

describe("App background sync while the first page is being cached", () => {
  it("applies a refresh that lands before the first page's cache write finishes", async () => {
    let releaseSave!: () => void;
    const slowSave = new Promise<void>(r => { releaseSave = r; });
    let saves = 0;
    handlers.save_cached_card_threads = async () => { if (saves++ === 0) await slowSave; return null; };
    render(() => <App />);
    await screen.findByText("Mail for A");

    handlers.sync_threads_incremental = () => ({
      modified_threads: [{ ...thread("t-a", "Mail for A"), labels: [] }],
      deleted_thread_ids: [],
      is_full_sync: false,
    });
    let releaseFetch!: () => void;
    const slowFetch = new Promise<void>(r => { releaseFetch = r; });
    const fetchPage = handlers.fetch_threads_paginated;
    handlers.fetch_threads_paginated = async (args) => { await slowFetch; return fetchPage({ ...args, cardId: "empty" }); };
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sync_threads_incremental", expect.anything()));

    releaseSave();
    await new Promise(r => setTimeout(r, 10));
    releaseFetch();

    await waitFor(() => expect(screen.queryByText("Mail for A")).not.toBeInTheDocument());
  });
});

describe("App background sync after an account switch", () => {
  it("ignores a sync result for the account that is no longer selected", async () => {
    handlers.get_accounts = () => [account("a", "a@x.com"), account("b", "b@x.com")];
    render(() => <App />);
    await screen.findByText("Mail for A");

    let releaseSync!: () => void;
    const slowSync = new Promise<void>(r => { releaseSync = r; });
    handlers.sync_threads_incremental = async () => {
      await slowSync;
      return { modified_threads: [thread("t-new", "New for A")], deleted_thread_ids: [], is_full_sync: false };
    };
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sync_threads_incremental", { accountId: "a" }));

    fireEvent.click(screen.getByTitle("a@x.com"));
    fireEvent.click(await screen.findByText("b@x.com"));
    await screen.findByText("Mail for B");
    const fetchesForB = () => invoke.mock.calls.filter(([cmd, args]) => cmd === "fetch_threads_paginated" && args?.cardId === "card-b").length;
    const before = fetchesForB();

    releaseSync();
    await new Promise(r => setTimeout(r, 30));
    expect(fetchesForB()).toBe(before);
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

  it("offers to save an attachment that is refused for opening because it can run code", async () => {
    threadsByCard["card-a"] = [{
      ...thread("t-a", "Mail for A"),
      has_attachment: true,
      attachments: [{
        message_id: "m1", attachment_id: "att1", filename: "setup.pkg",
        mime_type: "application/octet-stream", size: 10, inline_data: null, content_id: null,
      }],
    }];
    handlers.open_attachment = () => {
      throw "EXECUTABLE_ATTACHMENT: setup.pkg can run code on your computer, so Posta won't open it. Save it and open it yourself only if you trust the sender.";
    };
    handlers.save_attachment = () => "/Users/me/Downloads/setup.pkg";
    render(() => <App />);

    fireEvent.click(await screen.findByTitle("setup.pkg (10 B)"));
    fireEvent.click(await screen.findByRole("button", { name: "Save instead" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_attachment", expect.objectContaining({ attachmentId: "att1", filename: "setup.pkg" })));
    expect(await screen.findByText("Saved to /Users/me/Downloads/setup.pkg")).toBeInTheDocument();
  });

  it("opens a mailto link as a new email without the previous compose's attachments", async () => {
    threadsByCard["card-a"] = [{
      ...thread("t-a", "Mail for A"),
      has_attachment: true,
      attachments: [{
        message_id: "m1", attachment_id: "att1", filename: "report.pdf",
        mime_type: "application/pdf", size: 10, inline_data: "cGRm", content_id: null,
      }],
    }];
    render(() => <App />);
    fireEvent.contextMenu(await screen.findByTitle("report.pdf (10 B)"));
    await waitFor(() => expect(lastMenu.some(i => i.text === "Forward")).toBe(true));
    lastMenu.find(i => i.text === "Forward")!.action!();
    await waitFor(() => expect(document.querySelector(".compose-panel")).toHaveTextContent("report.pdf"));

    eventListeners["mailto-received"]({ payload: { to: "bo@y.com", cc: "", bcc: "", subject: "Hi", body: "" } });

    await waitFor(() => expect(screen.getByPlaceholderText("Recipients")).toHaveValue("bo@y.com"));
    expect(document.querySelector(".compose-panel")).not.toHaveTextContent("report.pdf");
  });

  it("opens a mailto link that launched the app once it listens for more", async () => {
    handlers.take_pending_mailtos = () => [{ to: "bo@y.com", cc: "", bcc: "", subject: "Hi", body: "" }];
    render(() => <App />);
    await waitFor(() => expect(screen.getByPlaceholderText("Recipients")).toHaveValue("bo@y.com"));
    expect(eventListeners["mailto-received"]).toBeDefined();
    const order = invoke.mock.calls.map(([cmd]) => cmd);
    expect(order.indexOf("take_pending_mailtos")).toBeGreaterThan(order.indexOf("get_accounts"));
  });

  it("opens a mailto link that launched the app even when startup fails", async () => {
    handlers.get_accounts = () => { throw new Error("offline"); };
    handlers.take_pending_mailtos = () => [{ to: "bo@y.com", cc: "", bcc: "", subject: "Hi", body: "" }];
    render(() => <App />);
    await waitFor(() => expect(screen.getByPlaceholderText("Recipients")).toHaveValue("bo@y.com"));
  });

  it("opens a new email on c while the previous one is still closing", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Subject"), { target: { value: "Old subject" } });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "c" });
    await new Promise(r => setTimeout(r, 300));

    expect(document.querySelector(".compose-panel")).not.toBeNull();
    expect(screen.getByPlaceholderText("Subject")).toHaveValue("");
  });

  it("forwards into a fresh email when compose is still closing", async () => {
    threadsByCard["card-a"] = [{
      ...thread("t-a", "Mail for A"),
      has_attachment: true,
      attachments: [{
        message_id: "m1", attachment_id: "att1", filename: "report.pdf",
        mime_type: "application/pdf", size: 10, inline_data: "cGRm", content_id: null,
      }],
    }];
    render(() => <App />);
    fireEvent.contextMenu(await screen.findByTitle("report.pdf (10 B)"));
    await waitFor(() => expect(lastMenu.some(i => i.text === "Forward")).toBe(true));

    fireEvent.click(screen.getByTitle("Compose"));
    fireEvent.input(await screen.findByPlaceholderText("Subject"), { target: { value: "Old subject" } });
    fireEvent.keyDown(document, { key: "Escape" });
    lastMenu.find(i => i.text === "Forward")!.action!();
    await new Promise(r => setTimeout(r, 300));

    const compose = document.querySelector(".compose-panel") as HTMLElement;
    expect(compose).not.toBeNull();
    expect(compose).toHaveTextContent("report.pdf");
    expect(screen.getByPlaceholderText("Subject")).toHaveValue("");
  });
});

describe("App mailto links", () => {
  it("opens a mailto link even when startup failed", async () => {
    delete eventListeners["mailto-received"];
    handlers.init_app = () => { throw new Error("database is locked"); };
    render(() => <App />);
    await screen.findAllByText(/database is locked/);

    await waitFor(() => expect(eventListeners["mailto-received"]).toBeDefined());
    eventListeners["mailto-received"]({ payload: { to: "bo@y.com", cc: "", bcc: "", subject: "Hi", body: "" } });
    await waitFor(() => expect(screen.getByPlaceholderText("Recipients")).toHaveValue("bo@y.com"));
  });

  it("listens for mailto links only once", async () => {
    listenedEvents.length = 0;
    render(() => <App />);
    await screen.findByText("Mail for A");
    await waitFor(() => expect(invoke.mock.calls.some(([cmd]) => cmd === "take_pending_mailtos")).toBe(true));
    expect(listenedEvents.filter(name => name === "mailto-received")).toHaveLength(1);
  });
});

describe("App card deletion", () => {
  it("stops counting a deleted card's unread threads in the dock badge", async () => {
    cardsByAccount.a = [card("card-a", "a", "Alpha"), { ...card("card-b", "a", "Beta"), position: 1 }];
    threadsByCard["card-a"] = [thread("t-a", "Mail for A")];
    threadsByCard["card-b"] = [{ ...thread("t-b", "Unread in B"), unread_count: 1 }];
    handlers.delete_card = () => null;
    render(() => <App />);
    await screen.findByText("Unread in B");
    await waitFor(() => expect(setBadgeCount).toHaveBeenLastCalledWith(1));

    fireEvent.click(screen.getAllByTitle("Edit query")[1]);
    fireEvent.click(await screen.findByRole("button", { name: /Delete/ }));

    await waitFor(() => expect(screen.queryByText("Unread in B")).not.toBeInTheDocument());
    await waitFor(() => expect(setBadgeCount).toHaveBeenLastCalledWith(undefined));
  });
});

describe("App failed thread action after an account switch", () => {
  it("does not roll the previous account's threads back into view", async () => {
    handlers.get_accounts = () => [account("a", "a@x.com"), account("b", "b@x.com")];
    threadsByCard["card-a"] = [{ ...thread("t-a", "Mail for A"), unread_count: 1, labels: ["INBOX", "UNREAD"] }];
    let failModify!: () => void;
    handlers.modify_threads = () => new Promise((_, reject) => { failModify = () => reject(new Error("offline")); });
    render(() => <App />);
    await screen.findByText("Mail for A");

    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "a" });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("modify_threads", expect.anything()));
    fireEvent.click(screen.getByTitle("a@x.com"));
    fireEvent.click(await screen.findByText("b@x.com"));
    await screen.findByText("Mail for B");

    failModify();
    await new Promise(r => setTimeout(r, 20));
    expect(setBadgeCount).toHaveBeenLastCalledWith(undefined);
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

  it("keeps a restored layout whose cards could not be deleted when starting from scratch", async () => {
    handlers.get_accounts = () => [];
    handlers.run_oauth_flow = () => account("a", "a@x.com");
    handlers.pull_from_icloud = () => true;
    handlers.delete_card = ({ id }) => {
      if (id === "card-a") throw new Error("db locked");
      return null;
    };
    cardsByAccount.a = [card("card-a", "a", "Alpha"), { ...card("card-z", "a", "Zeta"), position: 1 }];
    render(() => <App />);

    fireEvent.click(await screen.findByText("Sign in with Google"));
    fireEvent.click(await screen.findByText("Start from scratch", {}, { timeout: 3000 }));

    expect(await screen.findByText(/db locked/)).toBeInTheDocument();
    expect(screen.queryByText("How do you email?")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Alpha email card" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Zeta email card" })).not.toBeInTheDocument();
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

  it("closes the previous account's open thread when switching accounts", async () => {
    handlers.get_accounts = () => [account("a", "a@x.com"), account("b", "b@x.com")];
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m1");

    fireEvent.click(screen.getByTitle("a@x.com"));
    fireEvent.click(await screen.findByText("b@x.com"));

    await screen.findByText("Mail for B");
    expect(screen.queryByText("body m1")).not.toBeInTheDocument();
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

describe("App expired session", () => {
  it("keeps the account and its cards and offers to sign in again", async () => {
    handlers.delete_account = () => null;
    let expired = true;
    const fetchPage = handlers.fetch_threads_paginated;
    handlers.fetch_threads_paginated = (args) => {
      if (expired) throw new Error('Token refresh failed: {"error": "invalid_grant"}');
      return fetchPage(args);
    };
    handlers.run_oauth_flow = () => { expired = false; return account("a", "a@x.com"); };
    render(() => <App />);

    const banner = await waitFor(() => {
      const el = document.querySelector(".auth-error");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    const signIn = within(banner).getByRole("button", { name: "Sign in again" });
    await new Promise(r => setTimeout(r, 1700));
    expect(invoke).not.toHaveBeenCalledWith("delete_account", expect.anything());

    fireEvent.click(signIn);

    await screen.findByText("Mail for A");
    expect(invoke).not.toHaveBeenCalledWith("delete_account", expect.anything());
    expect(screen.queryAllByRole("button", { name: "Sign in again" })).toHaveLength(0);
  });
});

describe("App error banner", () => {
  it("shows a startup error once, positioned by the stylesheet rather than inline", async () => {
    handlers.get_accounts = () => [];
    handlers.init_app = () => { throw new Error("database is locked"); };
    render(() => <App />);
    await screen.findByText("Sign in with Google");
    await screen.findByText(/database is locked/);
    expect(screen.getAllByText(/database is locked/)).toHaveLength(1);
    const banner = document.querySelector(".auth-error") as HTMLElement;
    expect(banner.getAttribute("style")).toBeNull();
    banner.querySelectorAll("button").forEach(b => expect(b.getAttribute("style")).toBeNull());
  });
});

describe("App expired session after dismissing the banner", () => {
  it("still offers to sign in again from the card", async () => {
    let expired = true;
    const fetchPage = handlers.fetch_threads_paginated;
    handlers.fetch_threads_paginated = (args) => {
      if (expired) throw new Error('Token refresh failed: {"error": "invalid_grant"}');
      return fetchPage(args);
    };
    handlers.run_oauth_flow = () => { expired = false; return account("a", "a@x.com"); };
    render(() => <App />);

    await screen.findByRole("button", { name: "Dismiss error" });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    const cardError = await waitFor(() => {
      const el = document.querySelector(".card-error");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    fireEvent.click(within(cardError).getByRole("button", { name: "Sign in again" }));

    await screen.findByText("Mail for A");
  });
});

describe("App Gemini API key", () => {
  it("moves a key left in localStorage by earlier builds into the keychain", async () => {
    localStorage.setItem("gemini_api_key", "AIza-old");
    let stored = "";
    handlers.set_gemini_api_key = ({ apiKey }) => { stored = apiKey as string; return null; };
    handlers.has_gemini_api_key = () => stored !== "";
    render(() => <App />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_gemini_api_key", { apiKey: "AIza-old" }));
    await waitFor(() => expect(localStorage.getItem("gemini_api_key")).toBeNull());
    fireEvent.click(screen.getByText("Smart Replies"));
    expect(await screen.findByPlaceholderText("Saved in the keychain")).toBeInTheDocument();
  });

  it("keeps the old copy when the keychain refuses the key", async () => {
    localStorage.setItem("gemini_api_key", "AIza-old");
    handlers.set_gemini_api_key = () => { throw new Error("keychain locked"); };
    render(() => <App />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_gemini_api_key", { apiKey: "AIza-old" }));
    await new Promise(r => setTimeout(r, 0));
    expect(localStorage.getItem("gemini_api_key")).toBe("AIza-old");
  });

  it("saves and removes the key from Settings without keeping it in localStorage", async () => {
    handlers.set_gemini_api_key = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.click(screen.getByText("Smart Replies"));

    const field = screen.getByLabelText("Gemini API key");
    fireEvent.input(field, { target: { value: "AIza-new" } });
    fireEvent.change(field, { target: { value: "AIza-new" } });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_gemini_api_key", { apiKey: "AIza-new" }));
    expect(localStorage.getItem("gemini_api_key")).toBeNull();
    expect(await screen.findByPlaceholderText("Saved in the keychain")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_gemini_api_key", { apiKey: "" }));
    expect(await screen.findByPlaceholderText("AIza...")).toBeInTheDocument();
  });
});

describe("App signature", () => {
  it("saves the account's signature from Settings", async () => {
    handlers.update_account_signature = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");

    const field = screen.getByLabelText("Signature");
    fireEvent.change(field, { target: { value: "Ana\nPosta" } });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("update_account_signature", { accountId: "a", signature: "Ana\nPosta" }));

    fireEvent.change(field, { target: { value: "  " } });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("update_account_signature", { accountId: "a", signature: null }));
  });

  it("puts the signature in a new email and still restores a saved draft", async () => {
    handlers.get_accounts = () => [{ ...account("a", "a@x.com"), signature: "Ana" }];
    render(() => <App />);
    await screen.findByText("Mail for A");

    fireEvent.keyDown(document, { key: "c" });
    expect(((await screen.findByPlaceholderText("Write something...")) as HTMLTextAreaElement).value).toBe("\n\n-- \nAna");
    fireEvent.keyDown(screen.getByPlaceholderText("Write something..."), { key: "Escape" });
    await waitFor(() => expect(screen.queryByPlaceholderText("Write something...")).not.toBeInTheDocument());

    localStorage.setItem("draft_new_a", JSON.stringify({ to: "bo@x.com", cc: "", bcc: "", subject: "Hi", body: "saved\n\n-- \nAna", savedAt: 1 }));
    fireEvent.keyDown(document, { key: "c" });
    expect(((await screen.findByPlaceholderText("Write something...")) as HTMLTextAreaElement).value).toBe("saved\n\n-- \nAna");
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

  it("shows an enabled action missing from an older saved action order", async () => {
    localStorage.setItem("actionOrder", JSON.stringify(["markImportant", "markRead", "star", "quickReply", "quickForward", "archive", "trash"]));
    localStorage.setItem("actionSettings", JSON.stringify({ spam: true }));
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "x" });
    expect(await screen.findByTitle("Report spam")).toBeInTheDocument();
  });

  it("scrolls the focused card and thread into view", async () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
    render(() => <App />);
    const row = (await screen.findByText("Mail for A")).closest(".thread")!;
    fireEvent.keyDown(document, { key: "l" });
    await waitFor(() => expect(scrolled).toContain(row));
    expect(scrolled).toContain(screen.getByRole("region", { name: "Alpha email card" }).closest(".card-wrapper"));
  });

  it("undoes an action on the account it was taken in after switching accounts", async () => {
    handlers.get_accounts = () => [account("a", "a@x.com"), account("b", "b@x.com")];
    handlers.modify_threads = () => null;
    threadsByCard["card-a"] = [{ ...thread("t-a", "Mail for A"), labels: ["INBOX"] }];
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "a" });
    await screen.findByText("Archived 1 thread");

    fireEvent.click(screen.getByTitle("a@x.com"));
    fireEvent.click(await screen.findByText("b@x.com"));
    await screen.findByText("Mail for B");
    invoke.mockClear();
    fireEvent.click(screen.getByText("Undo"));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("modify_threads", {
      accountId: "a", threadIds: ["t-a"], addLabels: ["INBOX"], removeLabels: [],
    }));
    expect(invoke).not.toHaveBeenCalledWith("fetch_threads_paginated", expect.objectContaining({ accountId: "b", cardId: "card-a" }));
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
  payload: { mimeType: "text/plain", headers: [{ name: "From", value: from }, { name: "Subject", value: "Hi" }, { name: "Message-ID", value: `<${id}@x>` }], body: { size: 0 } },
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

describe("App thread view refresh after an action", () => {
  it("does not replace the thread the user moved on to", async () => {
    threadsByCard["card-a"] = [thread("t-a", "Mail for A"), thread("t-b", "Other mail")];
    handlers.modify_threads = () => null;
    let releaseRefresh!: () => void;
    const slowRefresh = new Promise<void>(r => { releaseRefresh = r; });
    let fetchesOfA = 0;
    handlers.get_thread_details = async ({ threadId }) => {
      if (threadId === "t-a" && fetchesOfA++ > 0) await slowRefresh;
      return { id: threadId, messages: [{ ...fullMessage(`m-${threadId}`, "Ana <ana@x.com>"), threadId }] };
    };
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m-t-a");

    fireEvent.click(screen.getByTitle("Star"));
    await waitFor(() => expect(fetchesOfA).toBe(2));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("body m-t-a")).not.toBeInTheDocument());
    fireEvent.click(await screen.findByText("Other mail"));
    await screen.findByText("body m-t-b");

    releaseRefresh();
    await new Promise(r => setTimeout(r, 20));
    expect(screen.getByText("body m-t-b")).toBeInTheDocument();
    expect(screen.queryByText("body m-t-a")).not.toBeInTheDocument();
  });
});

describe("App quick reaction", () => {
  it("reacts to the latest real message from someone else, not to a reaction", async () => {
    const headers = (from: string, id: string) => [{ name: "From", value: from }, { name: "Message-Id", value: id }];
    handlers.get_thread_details = () => ({
      id: "t-a",
      messages: [
        { ...fullMessage("m1", "Ana <ana@x.com>"), payload: { mimeType: "text/plain", headers: headers("Ana <ana@x.com>", "<m1@x>"), body: { size: 0 } } },
        {
          ...fullMessage("m2", "Bo <bo@x.com>"),
          payload: { mimeType: "text/plain", headers: headers("Bo <bo@x.com>", "<m2@x>"), body: { size: 0 } },
          reaction: { emoji: "👍", from_addr: "bo@x.com", in_reply_to: "<m1@x>", message_id: "<m2@x>" },
        },
        { ...fullMessage("m3", "Me <a@x.com>"), payload: { mimeType: "text/plain", headers: headers("Me <a@x.com>", "<m3@x>"), body: { size: 0 } } },
      ],
    });
    handlers.send_reaction = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");

    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "r" });
    fireEvent.click(await screen.findByTitle("Add reaction"));
    const emoji = document.querySelector<HTMLButtonElement>(".emoji-picker .emoji-btn")!;
    fireEvent.click(emoji);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("send_reaction", {
      accountId: "a", threadId: "t-a", messageId: "<m1@x>", emoji: emoji.textContent, toEmail: "ana@x.com",
    }));
  });
});

describe("App thread view reactions", () => {
  it("shows a toast when a reaction from the thread view fails", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    handlers.send_reaction = () => { throw new Error("quota exceeded"); };
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m1");

    fireEvent.click(screen.getAllByTitle("Add reaction")[0]);
    fireEvent.click(document.querySelector<HTMLButtonElement>(".emoji-picker .emoji-btn")!);

    expect(await screen.findByText(/Failed to send reaction: .*quota exceeded/)).toBeInTheDocument();
  });
});

describe("App compose autocomplete", () => {
  it("completes a later recipient from any contact without dropping earlier ones", async () => {
    handlers.fetch_contacts = () => Array.from({ length: 12 }, (_, i) => ({
      resource_name: `people/${i}`, display_name: i === 11 ? "Zed Last" : null,
      email_addresses: [`c${i}@y.com`], photo_url: null,
    }));
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    const to = await screen.findByPlaceholderText("Recipients");

    fireEvent.focus(to);
    fireEvent.input(to, { target: { value: "ana@x.com, zed" } });
    fireEvent.mouseDown(await screen.findByText("c11@y.com"));

    expect(to).toHaveValue("ana@x.com, c11@y.com");
  });
});

describe("App compose", () => {
  it("restores an email whose send was undone while compose was still closing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    handlers.send_email = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Recipients"), { target: { value: "bo@y.com" } });
    fireEvent.input(screen.getByPlaceholderText("Subject"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));

    fireEvent.click(document.querySelector(".toast-undo-btn")!);
    await vi.advanceTimersByTimeAsync(6000);

    expect(screen.getByPlaceholderText("Recipients")).toHaveValue("bo@y.com");
    expect(screen.getByPlaceholderText("Subject")).toHaveValue("Hello");
    expect(invoke).not.toHaveBeenCalledWith("send_email", expect.anything());
  });

  it("sends an undone new email as a new email while a reply is open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    handlers.send_email = () => null;
    handlers.reply_to_thread = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Recipients"), { target: { value: "bo@y.com" } });
    fireEvent.input(screen.getByPlaceholderText("Subject"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));
    await vi.advanceTimersByTimeAsync(300);

    fireEvent.click(screen.getByText("Mail for A"));
    await screen.findByText("body m1");
    fireEvent.keyDown(document, { key: "r" });
    await screen.findByPlaceholderText("Write your reply...");
    fireEvent.click(document.querySelector(".toast-undo-btn")!);
    await vi.advanceTimersByTimeAsync(100);

    expect(screen.getByPlaceholderText("Subject")).toHaveValue("Hello");
    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));
    await vi.advanceTimersByTimeAsync(6000);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("send_email", expect.objectContaining({ to: "bo@y.com", subject: "Hello" })));
    expect(invoke).not.toHaveBeenCalledWith("reply_to_thread", expect.anything());
  });

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

const calendarEvent = (id: string, title: string) => ({
  id, calendar_id: "primary", calendar_name: "Main", title, description: null, location: null,
  start_time: Date.now() + 3600_000, end_time: Date.now() + 7200_000, all_day: false, status: "confirmed",
  organizer: "org@x.com", attendees: [], html_link: null, hangout_link: null, response_status: null, can_edit: true,
});

describe("App calendar", () => {
  function calendarCards() {
    const calCard = (id: string, accountId: string, name: string): Card => ({
      ...card(id, accountId, name), query: "calendar:7d", card_type: "calendar",
    });
    handlers.get_accounts = () => [account("a", "a@x.com"), account("b", "b@x.com")];
    cardsByAccount.a = [calCard("cal-a", "a", "Agenda A")];
    cardsByAccount.b = [calCard("cal-b", "b", "Agenda B")];
    handlers.get_cached_card_events = () => null;
    handlers.save_cached_card_events = () => null;
    handlers.fetch_calendar_events = ({ accountId }) =>
      [calendarEvent(`ev-${accountId}`, `Event of ${accountId}`)];
  }

  it("quick-replies to the guests of the user's own event, not the user", async () => {
    calendarCards();
    handlers.fetch_calendar_events = () => [{
      ...calendarEvent("ev-a", "Planning"),
      organizer: "a@x.com",
      attendees: [
        { email: "a@x.com", display_name: null, response_status: null, is_self: true, is_organizer: true },
        { email: "bo@y.com", display_name: null, response_status: null, is_self: false, is_organizer: false },
      ],
    }];
    handlers.send_email = () => null;
    render(() => <App />);
    await screen.findByText("Planning");

    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "r" });
    const input = document.querySelector(".quick-reply-input") as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "See you there" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("send_email", expect.objectContaining({ to: "bo@y.com" })));
  });

  it("labels calendar cards as calendar cards", async () => {
    calendarCards();
    render(() => <App />);
    expect(await screen.findByRole("region", { name: "Agenda A calendar card" })).toBeInTheDocument();
  });

  it("removes a deleted event from every calendar card showing it", async () => {
    calendarCards();
    cardsByAccount.a = [
      { ...card("cal-1", "a", "Week"), query: "calendar:7d", card_type: "calendar" },
      { ...card("cal-2", "a", "Month"), query: "calendar:30d", card_type: "calendar", position: 1 },
    ];
    handlers.fetch_calendar_events = () => [calendarEvent("ev-1", "Planning")];
    handlers.delete_calendar_event = () => null;
    render(() => <App />);
    await waitFor(() => expect(screen.getAllByText("Planning")).toHaveLength(2));

    fireEvent.click(screen.getAllByText("Planning")[0]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.keyDown(document, { key: "d" });
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockRestore();

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_calendar_event", expect.anything()));
    await waitFor(() => expect(screen.queryAllByText("Planning")).toHaveLength(0));
  });

  it("edits one occurrence of a repeating event without offering a repeat rule", async () => {
    calendarCards();
    cardsByAccount.a = [{ ...card("cal-1", "a", "Week"), query: "calendar:7d", card_type: "calendar" }];
    handlers.fetch_calendar_events = () => [
      { ...calendarEvent("ev-1_20260101", "Standup"), recurring_event_id: "ev-1" },
      calendarEvent("ev-2", "Planning"),
    ];
    render(() => <App />);
    fireEvent.click(await screen.findByText("Standup"));
    fireEvent.keyDown(document, { key: "e" });
    expect(await screen.findByText("Repeats (editing this occurrence only)")).toBeInTheDocument();
    expect(screen.queryByText("Weekly")).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(await screen.findByText("Planning"));
    fireEvent.keyDown(document, { key: "e" });
    expect(await screen.findByText("Weekly")).toBeInTheDocument();
  });

  it("drops a deleted event from the calendar cards' saved cache", async () => {
    calendarCards();
    cardsByAccount.a = [{ ...card("cal-1", "a", "Week"), query: "calendar:7d", card_type: "calendar" }];
    handlers.fetch_calendar_events = () => [calendarEvent("ev-1", "Planning"), calendarEvent("ev-2", "Review")];
    handlers.delete_calendar_event = () => null;
    render(() => <App />);
    fireEvent.click(await screen.findByText("Planning"));
    invoke.mockClear();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.keyDown(document, { key: "d" });
    confirm.mockRestore();

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_cached_card_events", {
      cardId: "cal-1", events: [expect.objectContaining({ id: "ev-2" })],
    }));
  });

  it("updates the response in every calendar card and its cache after an RSVP", async () => {
    calendarCards();
    cardsByAccount.a = [
      { ...card("cal-1", "a", "Week"), query: "calendar:7d", card_type: "calendar" },
      { ...card("cal-2", "a", "Month"), query: "calendar:30d", card_type: "calendar", position: 1 },
    ];
    handlers.fetch_calendar_events = () => [{ ...calendarEvent("ev-1", "Planning"), response_status: "needsAction" }];
    handlers.rsvp_calendar_event = () => null;
    render(() => <App />);
    await waitFor(() => expect(screen.getAllByText("Planning")).toHaveLength(2));
    fireEvent.click(screen.getAllByText("Planning")[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Yes" }));

    for (const cardId of ["cal-1", "cal-2"]) {
      await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_cached_card_events", {
        cardId, events: [expect.objectContaining({ id: "ev-1", response_status: "accepted" })],
      }));
    }
  });

  it("does not show an account's calendars once another account is selected", async () => {
    calendarCards();
    let releaseA!: () => void;
    const slowA = new Promise<void>(r => { releaseA = r; });
    handlers.list_calendars = async ({ accountId }) => {
      if (accountId === "a") await slowA;
      return [{ id: `cal-${accountId}`, name: `Calendar of ${accountId}`, is_primary: false, access_role: "owner", timezone: null }];
    };
    render(() => <App />);

    fireEvent.click(await screen.findByText("Event of a"));
    fireEvent.click(await screen.findByTitle("Move to calendar"));

    fireEvent.click(screen.getByTitle("a@x.com"));
    fireEvent.click(await screen.findByText("b@x.com"));
    fireEvent.click(await screen.findByText("Event of b"));
    fireEvent.click(await screen.findByTitle("Move to calendar"));
    expect(await screen.findByText("Calendar of b")).toBeInTheDocument();

    releaseA();
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText("Calendar of a")).not.toBeInTheDocument();
  });
});

describe("App thread view compose", () => {
  it("sends a forward started after a reply as a new email, not as the reply", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    handlers.get_thread_details = () => ({
      id: "t-a",
      messages: [fullMessage("m1", "Ana <ana@x.com>"), fullMessage("m2", "Bo <bo@x.com>")],
    });
    handlers.send_email = () => null;
    handlers.reply_to_thread = () => null;
    handlers.save_draft = () => ({ id: "d1" });
    handlers.delete_draft = () => null;
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m2");

    fireEvent.keyDown(document, { key: "r" });
    await screen.findByPlaceholderText("Write your reply...");
    fireEvent.mouseEnter(document.querySelectorAll(".message-row")[0]);
    fireEvent.click(await screen.findByTitle("Forward"));
    await vi.advanceTimersByTimeAsync(100);
    fireEvent.input(await screen.findByPlaceholderText("Recipients"), { target: { value: "cy@z.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));
    await vi.advanceTimersByTimeAsync(6000);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("send_email", expect.objectContaining({ to: "cy@z.com" })));
    expect(invoke).not.toHaveBeenCalledWith("reply_to_thread", expect.anything());
  });
});

describe("App new email while a thread is open", () => {
  it("shows the new email over the thread and keeps it when the thread closes", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m1");

    eventListeners["mailto-received"]({ payload: { to: "bo@y.com", cc: "", bcc: "", subject: "Hello", body: "" } });
    await waitFor(() => expect(document.querySelector(".compose-panel")).not.toBeNull());
    expect(screen.getByPlaceholderText("Subject")).toHaveValue("Hello");
    expect(screen.queryByPlaceholderText("Write your reply...")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("body m1")).not.toBeInTheDocument());
    await new Promise(r => setTimeout(r, 300));
    expect(document.querySelector(".compose-panel")).not.toBeNull();
    expect(screen.getByPlaceholderText("Subject")).toHaveValue("Hello");
  });
});

describe("App quick reply", () => {
  it("replies at the Reply-To address", async () => {
    threadsByCard["card-a"] = [{ ...thread("t-a", "Mail for A"), participants: ["List <noreply@x.com>"] }];
    handlers.get_thread_details = () => ({
      id: "t-a",
      messages: [{
        ...fullMessage("m1", "List <noreply@x.com>"),
        payload: { mimeType: "text/plain", headers: [{ name: "From", value: "List <noreply@x.com>" }, { name: "Reply-To", value: "team@x.com" }], body: { size: 0 } },
      }],
    });
    handlers.reply_to_thread = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "r" });
    const input = document.querySelector(".quick-reply-input") as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "Thanks" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("reply_to_thread", expect.objectContaining({ to: "team@x.com", subject: "Re: Mail for A" })));
  });
});

describe("App quick reply threading", () => {
  it("replies to the latest message from someone else, not to a later reaction", async () => {
    handlers.get_thread_details = () => ({
      id: "t-a",
      messages: [
        fullMessage("m1", "Ana <ana@x.com>"),
        {
          ...fullMessage("m2", "Bo <bo@x.com>"),
          reaction: { emoji: "👍", from_addr: "bo@x.com", in_reply_to: "<m1@x>", message_id: "<m2@x>" },
        },
      ],
    });
    handlers.reply_to_thread = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "r" });
    const input = document.querySelector(".quick-reply-input") as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "Thanks" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("reply_to_thread", expect.objectContaining({ to: "ana@x.com", messageId: "m1" })));
  });
});

describe("App batch reply", () => {
  it("replies at the Reply-To address", async () => {
    handlers.get_thread_details = () => ({
      id: "t-a",
      messages: [{
        ...fullMessage("m1", "List <noreply@x.com>"),
        payload: { mimeType: "text/plain", headers: [{ name: "From", value: "List <noreply@x.com>" }, { name: "Reply-To", value: "team@x.com" }, { name: "Subject", value: "News" }], body: { size: 0 } },
      }],
    });
    handlers.reply_to_thread = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.click(await screen.findByTitle("Batch Reply"));
    fireEvent.input(await screen.findByPlaceholderText(/^Reply to/), { target: { value: "Thanks" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send ⌘/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("reply_to_thread", expect.objectContaining({ to: "team@x.com" })));
  });

  it("replies to the message it shows, not to the user's own later one", async () => {
    handlers.get_thread_details = () => ({
      id: "t-a",
      messages: [fullMessage("m1", "Ana <ana@x.com>"), fullMessage("m2", "Me <a@x.com>", {
        payload: { mimeType: "text/plain", headers: [{ name: "From", value: "a@x.com" }, { name: "To", value: "ana@x.com" }, { name: "Message-ID", value: "<m2@x>" }], body: { size: 0 } },
      })],
    });
    handlers.reply_to_thread = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.click(await screen.findByTitle("Batch Reply"));
    fireEvent.input(await screen.findByPlaceholderText(/^Reply to/), { target: { value: "Thanks" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send ⌘/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("reply_to_thread", expect.objectContaining({ to: "ana@x.com", messageId: "m1" })));
  });

  it("says why a thread with no one to reply to cannot be sent", async () => {
    handlers.get_thread_details = () => ({
      id: "t-a",
      messages: [fullMessage("m1", "a@x.com", {
        payload: { mimeType: "text/plain", headers: [{ name: "From", value: "a@x.com" }, { name: "To", value: "a@x.com" }, { name: "Subject", value: "Note to self" }], body: { size: 0 } },
      })],
    });
    handlers.reply_to_thread = () => { throw new Error("backend: invalid To header"); };
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.click(await screen.findByTitle("Batch Reply"));
    fireEvent.input(await screen.findByPlaceholderText(/^Reply to/), { target: { value: "Thanks" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send ⌘/ }));

    expect(await screen.findByText(/No one to reply to/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("reply_to_thread", expect.anything());
  });

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
