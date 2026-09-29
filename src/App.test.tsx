import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";

// Every test renders the whole app; on a loaded machine the defaults (5s per
// test, 1s per waitFor) fail tests that are only slow
vi.setConfig({ testTimeout: 20000 });
configure({ asyncUtilTimeout: 4000 });

type Handler = (args: Record<string, unknown>) => unknown;
const handlers: Record<string, Handler> = {};
const invoke = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
  const handler = handlers[cmd];
  if (!handler) throw new Error(`unmocked command ${cmd}`);
  return handler(args);
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args) }));
const setBadgeCount = vi.fn(async (_count?: number) => {});
const startDragging = vi.fn(async () => {});
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setBadgeCount: (count?: number) => setBadgeCount(count), startDragging: () => startDragging() }),
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
const openUrl = vi.fn(async (_url: string) => {});
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrl(url) }));
type MenuItemOptions = { text?: string; enabled?: boolean; action?: () => void };
let lastMenu: MenuItemOptions[] = [];
let menusCreated = 0;
vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: async ({ items }: { items: MenuItemOptions[] }) => { menusCreated++; return { popup: async () => { lastMenu = items; } }; } },
  MenuItem: { new: async (opts: MenuItemOptions) => opts },
  PredefinedMenuItem: { new: async () => ({}) },
}));

const regroupThreads = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./app/grouping", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./app/grouping")>();
  return {
    ...actual,
    regroupThreads: (...args: Parameters<typeof actual.regroupThreads>) => {
      regroupThreads.calls++;
      return actual.regroupThreads(...args);
    },
  };
});

const rankContacts = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./app/contacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./app/contacts")>();
  return {
    ...actual,
    rankContacts: (...args: Parameters<typeof actual.rankContacts>) => {
      rankContacts.calls++;
      return actual.rankContacts(...args);
    },
  };
});

import App from "./App";
import type { Account, Card, Thread } from "./api/tauri";
import { ICLOUD_RESTORE_DELAYS_MS } from "./app/icloudRestore";

ICLOUD_RESTORE_DELAYS_MS.first = 0;
ICLOUD_RESTORE_DELAYS_MS.retry = 0;

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
  rankContacts.calls = 0;
  localStorage.clear();
  lastMenu = [];
  invoke.mockClear();
  openUrl.mockClear();
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

// WKWebView answers window.confirm with Cancel; the app must ask in its own
// dialog, which these helpers answer
let nativeConfirm: { mockRestore: () => void };
beforeEach(() => {
  nativeConfirm = vi.spyOn(window, "confirm").mockImplementation(() => { throw new Error("window.confirm always cancels in WKWebView"); });
});

async function answerConfirm(yes: boolean, message?: RegExp | string): Promise<HTMLElement> {
  const dialog = await screen.findByRole("alertdialog");
  if (message !== undefined) expect(dialog).toHaveTextContent(message);
  const buttons = within(dialog).getAllByRole("button");
  fireEvent.click(yes ? buttons[buttons.length - 1] : within(dialog).getByRole("button", { name: "Cancel" }));
  return dialog;
}

afterEach(() => {
  nativeConfirm.mockRestore();
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

describe("App background sync updates", () => {
  it("updates a changed thread's row in place and leaves other cards alone", async () => {
    cardsByAccount.a = [card("card-a", "a", "Alpha"), { ...card("card-b", "a", "Beta"), position: 1 }];
    threadsByCard["card-b"] = [thread("t-b", "Mail for B")];
    render(() => <App />);
    const row = (await screen.findByText("Mail for A")).closest(".thread")!;
    const other = (await screen.findByText("Mail for B")).closest(".thread")!;
    await new Promise(r => setTimeout(r, 20));

    threadsByCard["card-a"] = [{ ...thread("t-a", "Mail for A"), unread_count: 1 }];
    handlers.sync_threads_incremental = () => ({
      modified_threads: [{ ...thread("t-a", "Mail for A"), unread_count: 1 }],
      deleted_thread_ids: [],
      is_full_sync: false,
    });
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(row).toHaveClass("unread"));
    expect(screen.getByText("Mail for A").closest(".thread")).toBe(row);
    expect(screen.getByText("Mail for B").closest(".thread")).toBe(other);
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
  it("reuses one native menu for every attachment right-click, acting on the one clicked last", async () => {
    const attachment = (id: string, filename: string) => ({
      message_id: "m1", attachment_id: id, filename, mime_type: "application/pdf", size: 10, inline_data: null, content_id: null,
    });
    threadsByCard["card-a"] = [{ ...thread("t-a", "Mail for A"), has_attachment: true, attachments: [attachment("att1", "one.pdf"), attachment("att2", "two.pdf")] }];
    handlers.save_attachment = ({ filename }) => `/Downloads/${filename}`;
    render(() => <App />);
    const before = menusCreated;
    fireEvent.contextMenu(await screen.findByTitle("one.pdf (10 B)"));
    await waitFor(() => expect(lastMenu.length).toBeGreaterThan(0));
    lastMenu = [];
    fireEvent.contextMenu(screen.getByTitle("two.pdf (10 B)"));
    await waitFor(() => expect(lastMenu.length).toBeGreaterThan(0));

    expect(menusCreated - before).toBe(1);
    lastMenu.find(i => i.text === "Download")!.action!();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_attachment", expect.objectContaining({ attachmentId: "att2", filename: "two.pdf" })));
  });

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
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));

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

describe("App locked keychain at startup", () => {
  const LOCKED = "Keychain unavailable (locked or access denied). Unlock the keychain and try again. (User interaction is not allowed.)";

  it("still shows the cards and their cached mail, says why, and reads the keychain again on focus", async () => {
    let locked = true;
    handlers.get_stored_credentials = () => { if (locked) throw LOCKED; return { client_id: "id", client_secret: "secret" }; };
    handlers.get_cached_card_threads = () => ({ groups: [{ label: "Today", threads: [thread("t-c", "Cached mail")] }], next_page_token: null, cached_at: 1 });
    render(() => <App />);

    expect(await screen.findByText("Cached mail")).toBeInTheDocument();
    expect(await screen.findByText(/Keychain unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/Session expired/)).not.toBeInTheDocument();

    locked = false;
    fireEvent.focus(window);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("configure_auth", { config: { client_id: "id", client_secret: "secret" } }));
    await waitFor(() => expect(screen.queryByText(/Keychain unavailable/)).not.toBeInTheDocument());
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
    await answerConfirm(true);

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
    const option = (await screen.findByText("Traditional")).closest(".preset-option")!;

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
    fireEvent.click((await screen.findByText("Traditional")).closest(".preset-option")!);

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
    fireEvent.click(await screen.findByText("Start from scratch"));
    await answerConfirm(true);

    expect(await screen.findByText(/db locked/)).toBeInTheDocument();
    expect(screen.queryByText("How do you email?")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Alpha email card" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Zeta email card" })).not.toBeInTheDocument();
  });

  it("stays on the preset picker when no card could be created", async () => {
    signInToEmptyLayout();
    handlers.create_card = () => { throw new Error("db locked"); };
    fireEvent.click(await screen.findByText("Sign in with Google"));
    fireEvent.click((await screen.findByText("Traditional")).closest(".preset-option")!);

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
    localStorage.setItem("collapsedCards", JSON.stringify({ "card-a": false, "card-b": true }));
    render(() => <App />);
    await screen.findByText("Mail for A");

    fireEvent.click(screen.getByText("Sign out"));
    await answerConfirm(true);

    const betaCard = await screen.findByRole("region", { name: "Beta email card" });
    expect(betaCard).toHaveClass("collapsed");
    expect(JSON.parse(localStorage.getItem("collapsedCards")!)).toEqual({ "card-b": true });
    expect(invoke).not.toHaveBeenCalledWith("fetch_threads_paginated", expect.objectContaining({ cardId: "card-b" }));
  });
});

describe("App expired session", () => {
  it("offers to sign in again when a background sync finds the session expired", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    handlers.sync_threads_incremental = () => { throw 'Token refresh failed: {"error": "invalid_grant"}'; };
    window.dispatchEvent(new Event("focus"));

    const banner = await waitFor(() => {
      const el = document.querySelector(".auth-error");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(banner).getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
    expect(screen.getByText("Mail for A")).toBeInTheDocument();
  });

  it("offers to sign in again when a card's background refresh finds the session expired", async () => {
    handlers.get_cached_card_threads = () => ({ groups: [{ label: "Today", threads: [thread("t-a", "Mail for A")] }], next_page_token: null, cached_at: 1 });
    handlers.fetch_threads_paginated = () => { throw "Keyring error: No refresh token found"; };
    render(() => <App />);
    await screen.findByText("Mail for A");

    const banner = await waitFor(() => {
      const el = document.querySelector(".auth-error");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(banner).getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  });

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

  it("is announced as an alert, and toasts as status messages", async () => {
    handlers.modify_threads = () => { throw new Error("offline"); };
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "s" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't star 1 thread: Error: offline");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Subject"), { target: { value: "Draft" } });
    handlers.save_draft = () => ({ id: "d1" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByRole("status")).toHaveTextContent("Draft saved");
  });

  it("says which card change failed", async () => {
    handlers.update_card = () => { throw new Error("db locked"); };
    handlers.create_card = () => { throw new Error("disk full"); };
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.click(screen.getByTitle("Edit query"));
    fireEvent.click(screen.getByTitle("Save (⌘Enter)"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the card: Error: db locked");

    fireEvent.click(screen.getByTitle("New card"));
    fireEvent.input(screen.getAllByPlaceholderText("Inbox, Starred...").slice(-1)[0], { target: { value: "News" } });
    fireEvent.input(screen.getAllByPlaceholderText("is:inbox, from:boss, newer_than:7d").slice(-1)[0], { target: { value: "label:news" } });
    fireEvent.click(screen.getByTitle("Add (⌘Enter)"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't add the card: Error: disk full"));
  });

  it("leaves an expired session's banner with its account when switching accounts", async () => {
    handlers.get_accounts = () => [account("a", "a@x.com"), account("b", "b@x.com")];
    render(() => <App />);
    await screen.findByText("Mail for A");
    handlers.sync_threads_incremental = () => { throw 'Token refresh failed: {"error": "invalid_grant"}'; };
    window.dispatchEvent(new Event("focus"));
    await screen.findByText("Session expired - sign in again");

    handlers.sync_threads_incremental = () => ({ modified_threads: [], deleted_thread_ids: [], is_full_sync: false });
    fireEvent.click(screen.getByTitle("a@x.com"));
    fireEvent.click(await screen.findByText("b@x.com"));
    await screen.findByText("Mail for B");
    expect(screen.queryByText("Session expired - sign in again")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("b@x.com"));
    fireEvent.click(await screen.findByText("a@x.com"));
    const banner = await screen.findByRole("alert");
    expect(within(banner).getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
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

describe("App card load errors", () => {
  it("says in words that Gmail couldn't be reached, keeping the backend's text for the sync tooltip", async () => {
    let offline = true;
    const fetchPage = handlers.fetch_threads_paginated;
    handlers.fetch_threads_paginated = (args) => {
      if (offline) throw "Search failed: Request failed: could not reach Gmail. Check your connection.";
      return fetchPage(args);
    };
    render(() => <App />);

    const cardError = await waitFor(() => {
      const el = document.querySelector(".card-error");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(cardError).toHaveTextContent("Couldn't reach Gmail. Check your connection and try again.");
    expect(cardError).not.toHaveTextContent("Search failed");
    offline = false;
    fireEvent.click(within(cardError).getByRole("button", { name: "Try again" }));
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

describe("App smart replies", () => {
  it("asks the keychain whether a Gemini key is saved once, not on every thread open", async () => {
    handlers.has_gemini_api_key = () => true;
    handlers.suggest_replies = () => ["Sure"];
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    render(() => <App />);
    for (let i = 0; i < 2; i++) {
      fireEvent.click(await screen.findByText("Mail for A"));
      await waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "suggest_replies")).toHaveLength(i + 1));
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(document.querySelector(".thread-overlay")).toBeNull());
    }
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "has_gemini_api_key")).toHaveLength(1);
  });
});

describe("App inline images", () => {
  // Gmail can hand out a new attachment id for the same part on every fetch
  it("downloads a thread's inline images once, not again on reopening it", async () => {
    let fetches = 0;
    handlers.get_thread_details = () => ({
      id: "t-a",
      messages: [fullMessage("m1", "Ana <ana@x.com>", {
        payload: {
          mimeType: "multipart/related",
          headers: [{ name: "From", value: "Ana <ana@x.com>" }],
          parts: [
            { mimeType: "text/html", body: { size: 9, data: "PGltZyBzcmM9ImNpZDpsb2dvQHgiPg" } },
            { mimeType: "image/png", headers: [{ name: "Content-ID", value: "<logo@x>" }], body: { size: 9, attachmentId: `att${++fetches}` } },
          ],
        },
      })],
    });
    handlers.download_attachment = () => "iVBORw0KGgo";
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("download_attachment", expect.objectContaining({ attachmentId: "att1" })));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".thread-overlay")).toBeNull());

    fireEvent.click(await screen.findByText("Mail for A"));
    await waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "get_thread_details")).toHaveLength(2));
    await new Promise(r => setTimeout(r, 30));
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "download_attachment")).toHaveLength(1);
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

  it("suggests only the selected account's contacts after switching accounts", async () => {
    handlers.get_accounts = () => [account("a", "a@x.com"), account("b", "b@x.com")];
    let releaseA!: () => void;
    const slowA = new Promise<void>(r => { releaseA = r; });
    let releaseB!: () => void;
    const slowB = new Promise<void>(r => { releaseB = r; });
    const contact = (name: string) => ({ resource_name: `people/${name}`, display_name: name, email_addresses: [`${name.toLowerCase()}@y.com`], photo_url: null });
    let callsForA = 0;
    handlers.fetch_contacts = async ({ accountId }) => {
      if (accountId === "a") {
        if (callsForA++ > 0) await slowA;
        return [contact(callsForA > 1 ? "Late" : "Ann")];
      }
      await slowB;
      return [contact("Bea")];
    };
    render(() => <App />);
    await screen.findByText("Mail for A");
    // The suggestions show while the pointer is over the compose button
    fireEvent.mouseEnter(document.querySelector(".compose-btn-wrapper")!);
    await screen.findByText("Ann");

    fireEvent.click(screen.getByTitle("a@x.com"));
    fireEvent.click(await screen.findByText("b@x.com"));
    await screen.findByText("Mail for B");
    expect(screen.queryByText("Ann")).not.toBeInTheDocument();

    // Back to A and at once to B: A's slow reply lands after B's
    fireEvent.click(screen.getByTitle("b@x.com"));
    fireEvent.click(await screen.findByText("a@x.com"));
    await screen.findByText("Mail for A");
    fireEvent.click(screen.getByTitle("a@x.com"));
    fireEvent.click(await screen.findByText("b@x.com"));
    await screen.findByText("Mail for B");
    releaseB();
    await screen.findByText("Bea");
    releaseA();
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText("Late")).not.toBeInTheDocument();
    expect(screen.getByText("Bea")).toBeInTheDocument();
  });

  it("attaches files dropped on a new email or pasted into a reply", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    const body = await screen.findByPlaceholderText("Write something...");
    const pdf = new File(["x"], "plan.pdf", { type: "application/pdf" });
    fireEvent.drop(body, { dataTransfer: { types: ["Files"], files: [pdf], items: [] } });
    expect(await screen.findByTitle("plan.pdf")).toBeInTheDocument();
    fireEvent.keyDown(body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByPlaceholderText("Write something...")).not.toBeInTheDocument());

    fireEvent.click(screen.getByText("Mail for A"));
    await screen.findByText("body m1");
    fireEvent.keyDown(document, { key: "r" });
    const reply = await screen.findByPlaceholderText("Write your reply...");
    const shot = new File(["png"], "", { type: "image/png" });
    fireEvent.paste(reply, { clipboardData: { types: ["Files"], files: [shot], items: [] } });
    expect(await screen.findByTitle("pasted-image.png")).toBeInTheDocument();
  });

  it("waits for a typed character before covering the fields with suggestions", async () => {
    handlers.fetch_contacts = () => [{ resource_name: "people/1", display_name: "Zed", email_addresses: ["zed@y.com"], photo_url: null }];
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    const to = await screen.findByPlaceholderText("Recipients");
    fireEvent.focus(to);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.input(to, { target: { value: "z" } });
    expect(await screen.findByRole("option", { name: /zed@y\.com/ })).toBeInTheDocument();
  });

  it("suggests contacts in a reply's recipient fields", async () => {
    handlers.fetch_contacts = () => [{ resource_name: "people/1", display_name: "Zed", email_addresses: ["zed@y.com"], photo_url: null }];
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.click(screen.getByText("Mail for A"));
    await screen.findByText("body m1");
    fireEvent.keyDown(document, { key: "r" });
    await screen.findByPlaceholderText("Write your reply...");
    const to = screen.getByPlaceholderText("Recipients");
    fireEvent.focus(to);
    fireEvent.input(to, { target: { value: "ana@x.com, ze" } });
    fireEvent.keyDown(to, { key: "Tab" });
    expect(to).toHaveValue("ana@x.com, zed@y.com");
  });

  it("saves a recipient picked from the suggestions in the draft", async () => {
    handlers.fetch_contacts = () => [{ resource_name: "people/1", display_name: "Zed", email_addresses: ["zed@y.com"], photo_url: null }];
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    const to = await screen.findByPlaceholderText("Recipients");
    fireEvent.focus(to);
    fireEvent.input(to, { target: { value: "ze" } });
    // Only the pick may save what follows
    localStorage.clear();
    fireEvent.mouseDown(await screen.findByText("zed@y.com"));

    const saved = Object.keys(localStorage).filter(k => k.startsWith("draft_new_a")).map(k => JSON.parse(localStorage.getItem(k)!));
    expect(saved).toEqual([expect.objectContaining({ to: "zed@y.com" })]);
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

// A fixed hour, so an event never straddles midnight (and shows under two
// days) when the tests run late in the evening
const tomorrowAt = (hour: number) => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};
const calendarEvent = (id: string, title: string) => ({
  id, calendar_id: "primary", calendar_name: "Main", title, description: null, location: null,
  start_time: tomorrowAt(10), end_time: tomorrowAt(11), all_day: false, status: "confirmed",
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

  it("loads the calendar list once when the calendar picker is opened twice quickly", async () => {
    calendarCards();
    let release!: () => void;
    const slow = new Promise<void>(r => { release = r; });
    handlers.list_calendars = async () => { await slow; return [{ id: "primary", name: "Main", is_primary: true }]; };
    render(() => <App />);
    fireEvent.click(await screen.findByText("Event of a"));
    const move = await screen.findByTitle("Move to calendar");
    fireEvent.click(move);
    fireEvent.click(move);
    release();

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_calendars", expect.anything()));
    await new Promise(r => setTimeout(r, 20));
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "list_calendars")).toHaveLength(1);
  });

  it("offers to sign in again when calendar access needs it", async () => {
    calendarCards();
    handlers.fetch_calendar_events = () => { throw "Calendar permission denied. Please re-login to grant calendar access."; };
    render(() => <App />);

    expect(await screen.findByText(/Calendar permission denied/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  });

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
    handlers.get_accounts = () => [{ ...account("a", "a@x.com"), signature: "Ana" }];
    render(() => <App />);
    await screen.findByText("Planning");

    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "r" });
    const input = document.querySelector(".quick-reply-input") as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "See you there" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("send_email", expect.objectContaining({ to: "bo@y.com", body: "See you there\n\n-- \nAna" })));
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
    fireEvent.keyDown(document, { key: "d" });
    expect(invoke).not.toHaveBeenCalledWith("delete_calendar_event", expect.anything());
    fireEvent.keyDown(document, { key: "d" });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_calendar_event", expect.anything()));
    await waitFor(() => expect(screen.queryAllByText("Planning")).toHaveLength(0));
  });

  it("selects a range of events with shift-click", async () => {
    calendarCards();
    handlers.fetch_calendar_events = () => ["One", "Two", "Three"].map((title, i) => ({ ...calendarEvent(`ev-${i}`, title), start_time: tomorrowAt(9 + i), end_time: tomorrowAt(10 + i) }));
    render(() => <App />);
    const box = (title: string) => within((screen.getByText(title)).closest(".calendar-event-item") as HTMLElement).getByRole("checkbox");
    await screen.findByText("Three");
    fireEvent.click(box("One"));
    fireEvent.click(box("Three"), { shiftKey: true });

    expect(box("One")).toBeChecked();
    expect(box("Two")).toBeChecked();
    expect(box("Three")).toBeChecked();
  });

  it("selects the focused event with x", async () => {
    calendarCards();
    render(() => <App />);
    const row = (await screen.findByText("Event of a")).closest(".calendar-event-item") as HTMLElement;
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "x" });

    expect(within(row).getByRole("checkbox")).toBeChecked();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(row).getByRole("checkbox")).not.toBeChecked();
  });

  it("moves the day labels and thread times on at midnight", async () => {
    const lateEvening = new Date();
    lateEvening.setHours(23, 59, 0, 0);
    vi.useFakeTimers({ shouldAdvanceTime: true, now: lateEvening });
    calendarCards();
    cardsByAccount.a = [card("card-a", "a", "Alpha"), { ...card("cal-1", "a", "Week"), query: "calendar:7d", card_type: "calendar", position: 1 }];
    threadsByCard["card-a"] = [{ ...thread("t-a", "Mail for A"), last_message_date: lateEvening.getTime() - 60_000 }];
    handlers.fetch_calendar_events = () => [calendarEvent("ev-1", "Planning")];
    render(() => <App />);
    await screen.findByText("Planning");
    const week = screen.getByRole("region", { name: "Week calendar card" });
    expect(within(week).getByText("Tomorrow")).toBeInTheDocument();
    const time = (await screen.findByText("Mail for A")).closest(".thread")!.querySelector(".thread-time")!;
    const eveningText = time.textContent;

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await waitFor(() => expect(within(week).getByText("Today")).toBeInTheDocument());
    expect(time.textContent).not.toBe(eveningText);
  });

  it("keeps an event's row when a refresh or the filter leaves it unchanged", async () => {
    calendarCards();
    cardsByAccount.a = [{ ...card("cal-1", "a", "Week"), query: "calendar:7d", card_type: "calendar" }];
    const planning = calendarEvent("ev-1", "Planning");
    const review = calendarEvent("ev-2", "Review");
    handlers.get_cached_card_events = () => ({ events: [planning, review], cached_at: 1 });
    handlers.fetch_calendar_events = () => structuredClone([planning, review]);
    render(() => <App />);
    const row = (await screen.findByText("Planning")).closest(".calendar-event-item");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_cached_card_events", expect.anything()));
    expect(screen.getByText("Planning").closest(".calendar-event-item")).toBe(row);

    fireEvent.keyDown(document, { key: "/" });
    const filter = await screen.findByPlaceholderText(/Filter threads/);
    fireEvent.input(filter, { target: { value: "p" } });
    fireEvent.input(filter, { target: { value: "pl" } });
    expect(screen.queryByText("Review")).not.toBeInTheDocument();
    expect(screen.getByText("Planning").closest(".calendar-event-item")).toBe(row);
  });

  it("creates a new event, not an edit of the last one, after closing an event mid-edit", async () => {
    calendarCards();
    cardsByAccount.a = [{ ...card("cal-1", "a", "Week"), query: "calendar:7d", card_type: "calendar" }];
    handlers.fetch_calendar_events = () => [calendarEvent("ev-1", "Planning")];
    handlers.create_calendar_event = () => calendarEvent("ev-2", "Lunch");
    handlers.update_calendar_event = () => calendarEvent("ev-1", "Lunch");
    render(() => <App />);
    fireEvent.click(await screen.findByText("Planning"));
    fireEvent.keyDown(document, { key: "e" });
    expect(await screen.findByDisplayValue("Planning")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle("Close (Esc)")[0]);
    await waitFor(() => expect(screen.queryByDisplayValue("Planning")).not.toBeInTheDocument());
    await new Promise(r => setTimeout(r, 300));

    fireEvent.keyDown(document, { key: "e" });
    const title = await screen.findByPlaceholderText("Event title");
    expect(title).toHaveValue("");
    fireEvent.input(title, { target: { value: "Lunch" } });
    fireEvent.keyDown(title, { key: "Enter", metaKey: true });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("create_calendar_event", expect.anything()));
    expect(invoke).not.toHaveBeenCalledWith("update_calendar_event", expect.anything());
  });

  it("asks before Escape throws away a new event's typed details", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "e" });
    const title = await screen.findByPlaceholderText("Event title");
    fireEvent.input(title, { target: { value: "Dentist" } });
    title.blur();
    fireEvent.keyDown(document, { key: "Escape" });
    await answerConfirm(false, /Discard/);
    await new Promise(r => setTimeout(r, 300));
    expect(screen.getByPlaceholderText("Event title")).toHaveValue("Dentist");

    fireEvent.keyDown(document, { key: "Escape" });
    await answerConfirm(true);
    await waitFor(() => expect(screen.queryByPlaceholderText("Event title")).not.toBeInTheDocument());
  });

  it("leaves Escape pressed in the event form's month picker to the picker", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "e" });
    await screen.findByPlaceholderText("Event title");
    const month = document.querySelector(".scheduler-header select") as HTMLSelectElement;
    month.focus();
    fireEvent.keyDown(month, { key: "Escape" });
    await new Promise(r => setTimeout(r, 300));

    expect(screen.getByPlaceholderText("Event title")).toBeInTheDocument();
  });

  it("starts a new event empty after an edit was cancelled with Escape", async () => {
    calendarCards();
    render(() => <App />);
    fireEvent.click(await screen.findByText("Event of a"));
    fireEvent.keyDown(document, { key: "e" });
    expect(await screen.findByDisplayValue("Event of a")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByDisplayValue("Event of a")).not.toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Escape" });
    await new Promise(r => setTimeout(r, 300));

    fireEvent.keyDown(document, { key: "e" });
    expect(await screen.findByPlaceholderText("Event title")).toHaveValue("");
  });

  it("starts a new event empty after an account switch left an event mid-edit", async () => {
    calendarCards();
    render(() => <App />);
    fireEvent.click(await screen.findByText("Event of a"));
    fireEvent.keyDown(document, { key: "e" });
    expect(await screen.findByDisplayValue("Event of a")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("a@x.com"));
    fireEvent.click(await screen.findByText("b@x.com"));
    expect(await screen.findByText("Event of b")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "e" });
    expect(await screen.findByPlaceholderText("Event title")).toHaveValue("");
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
    fireEvent.keyDown(document, { key: "d" });
    fireEvent.keyDown(document, { key: "d" });

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
    handlers.fetch_calendar_events = () => [{ ...calendarEvent("ev-1_20260928T150000Z", "Planning"), calendar_id: "team@group.calendar.google.com", response_status: "needsAction" }];
    handlers.rsvp_listed_calendar_event = () => null;
    render(() => <App />);
    await waitFor(() => expect(screen.getAllByText("Planning")).toHaveLength(2));
    fireEvent.click(screen.getAllByText("Planning")[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Yes" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("rsvp_listed_calendar_event", {
      accountId: "a", calendarId: "team@group.calendar.google.com", eventId: "ev-1_20260928T150000Z", status: "accepted",
    }));
    expect(invoke).not.toHaveBeenCalledWith("rsvp_calendar_event", expect.anything());

    for (const cardId of ["cal-1", "cal-2"]) {
      await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_cached_card_events", {
        cardId, events: [expect.objectContaining({ id: "ev-1_20260928T150000Z", response_status: "accepted" })],
      }));
    }
  });

  it("answers an invite from its email and shows the answer on the event in calendar cards", async () => {
    calendarCards();
    cardsByAccount.a = [card("card-a", "a", "Alpha"), { ...card("cal-1", "a", "Week"), query: "calendar:7d", card_type: "calendar", position: 1 }];
    threadsByCard["card-a"] = [{
      ...thread("t-inv", "Invitation: Planning"),
      calendar_event: {
        uid: "ev-1@google.com", title: "Planning", start_time: Date.now() + 3600_000, end_time: null, all_day: false,
        location: null, description: null, organizer: "org@x.com", attendees: [], method: "REQUEST", status: null, response_status: null,
      },
    }];
    handlers.fetch_calendar_events = () => [{ ...calendarEvent("ev-1", "Planning"), response_status: "needsAction" }];
    handlers.get_calendar_rsvp_status = () => null;
    handlers.rsvp_calendar_event = () => null;
    render(() => <App />);
    await screen.findByText("Invitation: Planning");
    await screen.findByText("Pending");

    const invite = screen.getByText("Invitation: Planning").closest(".thread") as HTMLElement;
    fireEvent.click(within(invite).getByRole("button", { name: "Yes" }));

    expect(await screen.findByText("RSVP sent: Going")).toBeInTheDocument();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_cached_card_events", {
      cardId: "cal-1", events: [expect.objectContaining({ id: "ev-1", response_status: "accepted" })],
    }));
  });

  it("looks an invite's answer up once per event, skips past events, and retries a failure on focus", async () => {
    const invite = (id: string, uid: string, start: number) => ({
      ...thread(id, `Invite ${id}`),
      calendar_event: {
        uid, title: "Planning", start_time: start, end_time: null, all_day: false,
        location: null, description: null, organizer: "org@x.com", attendees: [], method: "REQUEST", status: null, response_status: null,
      },
    });
    threadsByCard["card-a"] = [
      invite("t-1", "ev-1@google.com", Date.now() + 3600_000),
      invite("t-2", "ev-1@google.com", Date.now() + 3600_000),
      invite("t-old", "ev-old@google.com", Date.now() - 30 * 86400_000),
    ];
    let fail = true;
    handlers.get_calendar_rsvp_status = () => { if (fail) throw "could not reach Google Calendar"; return "accepted"; };
    const lookups = () => invoke.mock.calls.filter(([cmd]) => cmd === "get_calendar_rsvp_status");
    render(() => <App />);
    await screen.findByText("Invite t-1");
    await waitFor(() => expect(lookups()).toHaveLength(1));
    await new Promise(r => setTimeout(r, 30));
    expect(lookups()).toEqual([["get_calendar_rsvp_status", { accountId: "a", eventUid: "ev-1@google.com" }]]);

    fail = false;
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(lookups()).toHaveLength(2));
    for (const id of ["t-1", "t-2"]) {
      const row = screen.getByText(`Invite ${id}`).closest(".thread") as HTMLElement;
      await waitFor(() => expect(within(row).getByRole("button", { name: "Yes" })).toHaveClass("selected"));
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
  async function openBatchReplyForTwo() {
    threadsByCard["card-a"] = [thread("t-1", "One"), thread("t-2", "Two")];
    render(() => <App />);
    await screen.findByText("One");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.click(await screen.findByTitle("Batch Reply"));
  }

  it("says why no thread could be loaded and loads them again on Try again", async () => {
    let offline = true;
    handlers.get_thread_details = ({ threadId }) => {
      if (offline) throw "Failed to fetch thread: Request failed: could not reach Gmail. Check your connection.";
      return { id: threadId, messages: [fullMessage("m1", "Ana <ana@x.com>")] };
    };
    await openBatchReplyForTwo();

    expect(await screen.findByText("Couldn't reach Gmail. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByText("No threads to reply to")).not.toBeInTheDocument();
    offline = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getAllByPlaceholderText(/^Reply to/)).toHaveLength(2));
  });

  it("opens for the selected threads on r", async () => {
    handlers.get_thread_details = ({ threadId }) => ({ id: threadId, messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    threadsByCard["card-a"] = [thread("t-1", "One"), thread("t-2", "Two")];
    render(() => <App />);
    await screen.findByText("One");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.keyDown(document, { key: "r" });
    await waitFor(() => expect(screen.getAllByPlaceholderText(/^Reply to/)).toHaveLength(2));
    expect(screen.getByText("Batch Reply")).toBeInTheDocument();
  });

  it("attaches a file dropped on one reply to that reply only", async () => {
    handlers.get_thread_details = ({ threadId }) => ({ id: threadId, messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    await openBatchReplyForTwo();
    await waitFor(() => expect(screen.getAllByPlaceholderText(/^Reply to/)).toHaveLength(2));
    const [first] = screen.getAllByPlaceholderText(/^Reply to/);
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    fireEvent.drop(first, { dataTransfer: { types: ["Files"], files: [file], items: [] } });
    expect(await screen.findByTitle("notes.txt")).toBeInTheDocument();
    expect(screen.getAllByTitle("notes.txt")).toHaveLength(1);
  });

  it("says how many replies Send All couldn't send, keeping them in the list", async () => {
    handlers.get_thread_details = ({ threadId }) => ({ id: threadId, messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    handlers.reply_to_thread = ({ threadId }) => { if (threadId === "t-2") throw "API error 500"; return null; };
    await openBatchReplyForTwo();
    await waitFor(() => expect(screen.getAllByPlaceholderText(/^Reply to/)).toHaveLength(2));
    for (const field of screen.getAllByPlaceholderText(/^Reply to/)) fireEvent.input(field, { target: { value: "Thanks" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send All/ }));

    expect(await screen.findByText(/Couldn't send 1 of 2 replies/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByPlaceholderText(/^Reply to/)).toHaveLength(1));
  });

  it("shows a message's inline images, downloading those that didn't come with it", async () => {
    // <img src="cid:logo@x"><img src="cid:chart@x">
    const html = btoa('<img src="cid:logo@x"><img src="cid:chart@x">').replace(/=+$/, "");
    handlers.get_thread_details = ({ threadId }) => ({
      id: threadId,
      messages: [{
        ...fullMessage("m1", "Ana <ana@x.com>"),
        payload: {
          mimeType: "multipart/related",
          headers: [{ name: "From", value: "Ana <ana@x.com>" }, { name: "Subject", value: "Hi" }],
          parts: [
            { mimeType: "text/html", body: { size: 9, data: html } },
            { mimeType: "image/png", headers: [{ name: "Content-ID", value: "<logo@x>" }], body: { size: 9, data: "TE9HTw" } },
            { mimeType: "image/png", headers: [{ name: "Content-ID", value: "<chart@x>" }], body: { size: 9, attachmentId: "att-chart" } },
          ],
        },
      }],
    });
    handlers.download_attachment = () => "Q0hBUlQ";
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.click(await screen.findByTitle("Batch Reply"));

    await waitFor(() => {
      const sources = Array.from(document.querySelectorAll(".thread-overlay .message-body img")).map(img => img.getAttribute("src"));
      expect(sources).toEqual(["data:image/png;base64,TE9HTw", "data:image/png;base64,Q0hBUlQ"]);
    });
  });

  it("says how many threads could not be loaded when only some fail", async () => {
    handlers.get_thread_details = ({ threadId }) => {
      if (threadId === "t-2") throw "API error 500";
      return { id: threadId, messages: [fullMessage("m1", "Ana <ana@x.com>")] };
    };
    await openBatchReplyForTwo();

    expect(await screen.findByText("Couldn't load 1 of 2 emails")).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText(/^Reply to/)).toHaveLength(1);
  });

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

  it("signs each reply", async () => {
    handlers.get_accounts = () => [{ ...account("a", "a@x.com"), signature: "Ana" }];
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Bo <bo@x.com>")] });
    handlers.reply_to_thread = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.click(await screen.findByTitle("Batch Reply"));
    fireEvent.input(await screen.findByPlaceholderText(/^Reply to/), { target: { value: "Thanks" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send ⌘/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("reply_to_thread", expect.objectContaining({ body: "Thanks\n\n-- \nAna" })));
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

describe("App drafts", () => {
  const draftKeys = (prefix: string) => Object.keys(localStorage).filter(k => k.startsWith(prefix));
  const storedDrafts = (prefix: string) => draftKeys(prefix).map(k => JSON.parse(localStorage.getItem(k)!));

  it("clears out closed drafts that Gmail already holds when it starts", async () => {
    localStorage.setItem("draft_new_a#old", JSON.stringify({ to: "", cc: "", bcc: "", subject: "Kept in Gmail", body: "", savedAt: 1, syncedAt: 1, closed: true, gmailDraftId: "d1" }));
    localStorage.setItem("draft_new_a#mine", JSON.stringify({ to: "", cc: "", bcc: "", subject: "Only here", body: "", savedAt: 1, closed: true }));
    render(() => <App />);
    await screen.findByText("Mail for A");

    expect(draftKeys("draft_new_a")).toEqual(["draft_new_a#mine"]);
  });

  it("files a draft started before sign-in under the account it is sent from", async () => {
    handlers.get_accounts = () => [];
    handlers.take_pending_mailtos = () => [{ to: "bo@y.com", cc: "", bcc: "", subject: "Hi", body: "" }];
    handlers.run_oauth_flow = () => account("a", "a@x.com");
    render(() => <App />);
    const subject = await screen.findByPlaceholderText("Subject");
    fireEvent.input(subject, { target: { value: "Hi there" } });
    expect(draftKeys("draft_new_undefined")).toHaveLength(1);

    fireEvent.click(await screen.findByText("Sign in with Google"));
    await screen.findByText("Mail for A");
    fireEvent.input(screen.getByPlaceholderText("Subject"), { target: { value: "Hi there!" } });

    expect(draftKeys("draft_new_undefined")).toEqual([]);
    expect(storedDrafts("draft_new_a")).toEqual([expect.objectContaining({ subject: "Hi there!" })]);
  });

  it("keeps typed text locally before the draft is synced", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Subject"), { target: { value: "Typed" } });

    expect(storedDrafts("draft_new_a")).toEqual([expect.objectContaining({ subject: "Typed" })]);
  });

  it("keeps a sent email's draft until the send goes out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    handlers.save_draft = () => ({ id: "d1" });
    handlers.delete_draft = () => null;
    handlers.send_email = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Recipients"), { target: { value: "bo@y.com" } });
    fireEvent.input(screen.getByPlaceholderText("Subject"), { target: { value: "Hello" } });
    await vi.advanceTimersByTimeAsync(3500);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_draft", expect.anything()));

    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(invoke).not.toHaveBeenCalledWith("delete_draft", expect.anything());
    expect(storedDrafts("draft_new_a")).toEqual([expect.objectContaining({ subject: "Hello" })]);

    await vi.advanceTimersByTimeAsync(5000);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("send_email", expect.anything()));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_draft", { accountId: "a", draftId: "d1" }));
    expect(draftKeys("draft_new_a")).toEqual([]);
  });

  it("marks an email waiting out the undo window as being sent, and unmarks it on undo", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Recipients"), { target: { value: "bo@y.com" } });
    fireEvent.input(screen.getByPlaceholderText("Subject"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));

    expect(storedDrafts("draft_new_a")).toEqual([expect.objectContaining({ subject: "Hello", sending: true, accountId: "a" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByPlaceholderText("Subject")).toHaveValue("Hello"));
    expect(storedDrafts("draft_new_a")).toEqual([expect.not.objectContaining({ sending: true })]);
  });

  it("says when an email was still waiting to be sent when Posta quit", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    localStorage.setItem("draft_reply_a_t-a#q", JSON.stringify({
      to: "ana@x.com", cc: "", bcc: "", subject: "Re: Hi", body: "unsent reply", threadId: "t-a", savedAt: 5, sending: true, accountId: "a",
    }));
    render(() => <App />);

    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    expect(screen.getByText("An email wasn't sent before Posta quit")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByDisplayValue("unsent reply")).toBeInTheDocument());
    expect(storedDrafts("draft_reply_a_t-a")).toEqual([expect.not.objectContaining({ sending: true })]);
  });

  // Posta quitting during the undo window: the local draft is all that's left
  async function quitAndRestart() {
    const saved = { ...localStorage };
    cleanup();
    localStorage.clear();
    for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
    invoke.mockClear();
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
  }

  it("sends an unsent reply again as a reply to the same message", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>"), fullMessage("m2", "Bo <bo@x.com>")] });
    handlers.reply_to_thread = () => null;
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m1");
    fireEvent.keyDown(document, { key: "r" });
    fireEvent.input(await screen.findByPlaceholderText("Write your reply..."), { target: { value: "unsent reply" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));
    await quitAndRestart();

    fireEvent.click(await screen.findByRole("button", { name: /^Send/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("reply_to_thread", expect.objectContaining({ threadId: "t-a", messageId: "<m2@x>" })), { timeout: 8000 });
  });

  it("reopens an unsent forward as a forward of its thread", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "f" });
    fireEvent.input(await screen.findByPlaceholderText("Recipients"), { target: { value: "bo@y.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));
    await quitAndRestart();

    await waitFor(() => expect(document.querySelector(".compose-panel")).not.toBeNull());
    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m1");
    // A forward of the open thread is written inside it, not in the panel
    await waitFor(() => expect(document.querySelector(".compose-panel")).toBeNull());
    expect(screen.getByDisplayValue("bo@y.com")).toBeInTheDocument();
  });

  it("names the attachments an unsent email lost when Posta quit", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Recipients"), { target: { value: "bo@y.com" } });
    await attachFile("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));
    await quitAndRestart();

    expect(await screen.findByText(/Attach again: notes\.txt/)).toBeInTheDocument();
  });

  it("offers to reopen a closed email with its attachments, which drafts can't keep", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Subject"), { target: { value: "With a file" } });
    await attachFile("notes.txt");
    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByText(/Draft saved without notes\.txt/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByPlaceholderText("Subject")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(await screen.findByTitle("notes.txt")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Subject")).toHaveValue("With a file");
  });

  it("keeps a closed email that holds only attachments one toast away", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    await screen.findByPlaceholderText("Subject");
    await attachFile("notes.txt");
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(await screen.findByRole("button", { name: "Reopen" }));
    expect(await screen.findByTitle("notes.txt")).toBeInTheDocument();
  });

  it("does not reopen an email that is being sent as a draft", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    handlers.send_email = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Recipients"), { target: { value: "bo@y.com" } });
    fireEvent.input(screen.getByPlaceholderText("Subject"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));
    await vi.advanceTimersByTimeAsync(1000);

    fireEvent.keyDown(document, { key: "c" });
    await waitFor(() => expect(screen.getByPlaceholderText("Subject")).toHaveValue(""));
    expect(screen.getByPlaceholderText("Recipients")).toHaveValue("");
  });

  it("keeps the draft of a send that failed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    handlers.send_email = () => { throw new Error("offline"); };
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Recipients"), { target: { value: "bo@y.com" } });
    fireEvent.input(screen.getByPlaceholderText("Subject"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));
    await vi.advanceTimersByTimeAsync(6000);

    await waitFor(() => expect(screen.getByPlaceholderText("Subject")).toHaveValue("Hello"));
    expect(invoke).not.toHaveBeenCalledWith("delete_draft", expect.anything());
    expect(storedDrafts("draft_new_a")).toEqual([expect.objectContaining({ subject: "Hello" })]);
  });

  it("leaves the email being written open when an earlier send fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    handlers.send_email = () => { throw new Error("offline"); };
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Recipients"), { target: { value: "bo@y.com" } });
    fireEvent.input(screen.getByPlaceholderText("Subject"), { target: { value: "First" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));
    await vi.advanceTimersByTimeAsync(500);
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Subject"), { target: { value: "Second" } });
    await vi.advanceTimersByTimeAsync(6000);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("send_email", expect.objectContaining({ subject: "First" })));
    expect(screen.getByPlaceholderText("Subject")).toHaveValue("Second");
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByPlaceholderText("Subject")).toHaveValue("First"));
    expect(storedDrafts("draft_new_a").map(d => d.subject).sort()).toEqual(["First", "Second"]);
  });

  it("keeps a closed compose's draft and offers to discard it", async () => {
    handlers.save_draft = () => ({ id: "d1" });
    handlers.delete_draft = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Subject"), { target: { value: "Half written" } });
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_draft", expect.objectContaining({ subject: "Half written" })));
    expect(invoke).not.toHaveBeenCalledWith("delete_draft", expect.anything());
    expect(storedDrafts("draft_new_a")).toEqual([expect.objectContaining({ subject: "Half written" })]);

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_draft", { accountId: "a", draftId: "d1" }));
    expect(draftKeys("draft_new_a")).toEqual([]);
  });

  it("offers to open a closed compose's draft again", async () => {
    handlers.save_draft = () => ({ id: "d1" });
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Subject"), { target: { value: "Half written" } });
    fireEvent.keyDown(document, { key: "Escape" });

    const toast = await screen.findByRole("status");
    expect(within(toast).getByRole("button", { name: "Discard" })).toBeInTheDocument();
    fireEvent.click(within(toast).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByPlaceholderText("Subject")).toHaveValue("Half written"));
  });

  describe("drafts in Gmail", () => {
    const draftMessage = (id: string, threadId: string, headers: Record<string, string>, body: string) => ({
      id, threadId, labelIds: ["DRAFT"], snippet: body, internalDate: "0",
      payload: {
        mimeType: "text/plain",
        headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
        body: { size: body.length, data: btoa(body) },
      },
    });

    it("opens a thread that is only a draft as a new email that saves over that draft", async () => {
      threadsByCard["card-a"] = [{ ...thread("t-d", "Plans"), labels: ["DRAFT"] }];
      handlers.get_thread_details = () => ({ id: "t-d", messages: [draftMessage("dm", "t-d", { To: "ana@x.com", Subject: "Plans" }, "Hello")] });
      handlers.list_thread_drafts = () => [{ id: "g1", message: { id: "dm", threadId: "t-d" } }];
      handlers.save_draft = () => ({ id: "g1" });
      render(() => <App />);
      fireEvent.click(await screen.findByText("Plans"));

      await waitFor(() => expect(screen.getByPlaceholderText("Recipients")).toHaveValue("ana@x.com"));
      expect(screen.getByPlaceholderText("Subject")).toHaveValue("Plans");
      const body = screen.getByPlaceholderText("Write something...");
      expect(body).toHaveValue("Hello");
      expect(screen.queryByPlaceholderText("Write your reply...")).not.toBeInTheDocument();

      fireEvent.input(body, { target: { value: "Hello again" } });
      fireEvent.keyDown(body, { key: "Escape" });
      await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_draft", expect.objectContaining({ draftId: "g1", body: "Hello again", threadId: null })));
    });

    it("offers a draft opened over an email being written instead of replacing it", async () => {
      threadsByCard["card-a"] = [{ ...thread("t-d", "Plans"), labels: ["DRAFT"] }];
      handlers.get_thread_details = () => ({ id: "t-d", messages: [draftMessage("dm", "t-d", { To: "ana@x.com", Subject: "Plans" }, "Hello")] });
      handlers.list_thread_drafts = () => [{ id: "g1", message: { id: "dm", threadId: "t-d" } }];
      render(() => <App />);
      await screen.findByText("Plans");
      fireEvent.keyDown(document, { key: "c" });
      fireEvent.input(await screen.findByPlaceholderText("Subject"), { target: { value: "Writing" } });
      fireEvent.click(screen.getByText("Plans"));

      const toast = await screen.findByText("Draft: Plans");
      expect(screen.getByPlaceholderText("Subject")).toHaveValue("Writing");
      fireEvent.click(within(toast.closest("[role=status]") as HTMLElement).getByRole("button", { name: "Open" }));
      await waitFor(() => expect(screen.getByPlaceholderText("Subject")).toHaveValue("Plans"));
    });

    it("opens a reply draft in the thread's inline reply", async () => {
      threadsByCard["card-a"] = [{ ...thread("t-a", "Mail for A"), labels: ["INBOX", "DRAFT"] }];
      handlers.get_thread_details = () => ({
        id: "t-a",
        messages: [fullMessage("m1", "Ana <ana@x.com>"), draftMessage("dm", "t-a", { To: "ana@x.com", Subject: "Re: Hi" }, "Draft reply")],
      });
      handlers.list_thread_drafts = () => [{ id: "g2", message: { id: "dm", threadId: "t-a" } }];
      handlers.save_draft = () => ({ id: "g2" });
      render(() => <App />);
      fireEvent.click(await screen.findByText("Mail for A"));

      const reply = await screen.findByPlaceholderText("Write your reply...");
      await waitFor(() => expect(reply).toHaveValue("Draft reply"));
      fireEvent.input(reply, { target: { value: "Draft reply, edited" } });
      fireEvent.keyDown(reply, { key: "Escape" });
      await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_draft", expect.objectContaining({ draftId: "g2", threadId: "t-a", body: "Draft reply, edited" })));
    });

    it("discards a draft row's drafts from the row, without opening it", async () => {
      threadsByCard["card-a"] = [{ ...thread("t-d", "Plans"), labels: ["DRAFT"] }, thread("t-a", "Mail for A")];
      handlers.list_thread_drafts = () => [{ id: "g1", message: { id: "dm", threadId: "t-d" } }];
      handlers.delete_draft = () => null;
      render(() => <App />);
      const row = (await screen.findByText("Plans")).closest(".thread") as HTMLElement;
      expect(within(screen.getByText("Mail for A").closest(".thread") as HTMLElement).queryByRole("button", { name: "Discard draft" })).toBeNull();

      fireEvent.click(within(row).getByRole("button", { name: "Discard draft" }));

      await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_draft", { accountId: "a", draftId: "g1" }));
      await waitFor(() => expect(screen.queryByText("Plans")).not.toBeInTheDocument());
      expect(invoke).not.toHaveBeenCalledWith("get_thread_details", expect.anything());
    });

    it("leaves Enter on a draft row's Discard to the button, not to the keyboard-focused thread", async () => {
      threadsByCard["card-a"] = [{ ...thread("t-d", "Plans"), labels: ["DRAFT"] }];
      handlers.list_thread_drafts = () => [{ id: "g1", message: { id: "dm", threadId: "t-d" } }];
      handlers.delete_draft = () => null;
      render(() => <App />);
      const row = (await screen.findByText("Plans")).closest(".thread") as HTMLElement;
      fireEvent.keyDown(document, { key: "j" });
      await waitFor(() => expect(row).toHaveClass("focused"));

      const discard = within(row).getByRole("button", { name: "Discard draft" });
      discard.focus();
      fireEvent.keyDown(discard, { key: "Enter" });
      fireEvent.click(discard);

      await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_draft", { accountId: "a", draftId: "g1" }));
      expect(invoke).not.toHaveBeenCalledWith("get_thread_details", expect.anything());
    });
  });

  describe("when local storage refuses drafts", () => {
    let restoreStorage: () => void;
    beforeEach(() => {
      const setItem = Storage.prototype.setItem;
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
        if (key.startsWith("draft_")) throw new Error("QuotaExceededError");
        setItem.call(this, key, value);
      });
      restoreStorage = () => spy.mockRestore();
    });
    afterEach(() => restoreStorage());

    it("saves a closed compose's draft to Gmail instead of deleting it", async () => {
      handlers.save_draft = () => ({ id: "d1" });
      handlers.delete_draft = () => null;
      render(() => <App />);
      await screen.findByText("Mail for A");
      fireEvent.keyDown(document, { key: "c" });
      fireEvent.input(await screen.findByPlaceholderText("Subject"), { target: { value: "Only copy" } });
      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_draft", expect.objectContaining({ subject: "Only copy" })));
      expect(await screen.findByText("Draft saved in Gmail")).toBeInTheDocument();
      expect(invoke).not.toHaveBeenCalledWith("delete_draft", expect.anything());

      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
      await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_draft", { accountId: "a", draftId: "d1" }));
    });

    it("offers to reopen a closed compose whose draft could be saved nowhere", async () => {
      handlers.save_draft = () => { throw new Error("offline"); };
      handlers.delete_draft = () => null;
      render(() => <App />);
      await screen.findByText("Mail for A");
      fireEvent.keyDown(document, { key: "c" });
      fireEvent.input(await screen.findByPlaceholderText("Subject"), { target: { value: "Only copy" } });
      fireEvent.keyDown(document, { key: "Escape" });

      fireEvent.click(await screen.findByRole("button", { name: "Reopen" }));
      await waitFor(() => expect(screen.getByPlaceholderText("Subject")).toHaveValue("Only copy"));
      expect(invoke).not.toHaveBeenCalledWith("delete_draft", expect.anything());

      // Closing the reopened email untouched still keeps it
      await waitFor(() => expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument());
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.click(await screen.findByRole("button", { name: "Reopen" }));
      await waitFor(() => expect(screen.getByPlaceholderText("Subject")).toHaveValue("Only copy"));
    });
  });

  it("does not keep a draft for a compose that was never typed in", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    await screen.findByPlaceholderText("Subject");
    fireEvent.keyDown(document, { key: "Escape" });
    await new Promise(r => setTimeout(r, 300));

    expect(draftKeys("draft_")).toEqual([]);
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
  });

  async function attachFile(name: string) {
    const input = document.getElementById("compose-file-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(["data"], name, { type: "text/plain" })], configurable: true });
    fireEvent.change(input);
    await screen.findByTitle(name);
  }

  it("keeps the email being written, attachments and all, when an undone send would replace it", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Recipients"), { target: { value: "bo@y.com" } });
    fireEvent.input(screen.getByPlaceholderText("Subject"), { target: { value: "Sent one" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));
    await waitFor(() => expect(screen.queryByPlaceholderText("Subject")).not.toBeInTheDocument());

    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Subject"), { target: { value: "Being written" } });
    await attachFile("notes.txt");
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    expect(await screen.findByText(/"Sent one" wasn't sent/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Subject")).toHaveValue("Being written");
    expect(screen.getByTitle("notes.txt")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("send_email", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByPlaceholderText("Subject")).toHaveValue("Sent one"));
  });

  it("keeps the email being written, attachments and all, when a mailto link arrives", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Subject"), { target: { value: "Being written" } });
    await attachFile("notes.txt");

    eventListeners["mailto-received"]({ payload: { to: "bo@y.com", cc: "", bcc: "", subject: "Second", body: "" } });

    expect(await screen.findByText("New email to bo@y.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Subject")).toHaveValue("Being written");
    expect(screen.getByTitle("notes.txt")).toBeInTheDocument();
  });

  it("keeps an open compose's text when a mailto link replaces it", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.input(await screen.findByPlaceholderText("Subject"), { target: { value: "First" } });

    eventListeners["mailto-received"]({ payload: { to: "bo@y.com", cc: "", bcc: "", subject: "Second", body: "" } });
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByPlaceholderText("Subject")).toHaveValue("Second"));
    fireEvent.input(screen.getByPlaceholderText("Subject"), { target: { value: "Second!" } });

    expect(storedDrafts("draft_new_a").map(d => d.subject).sort()).toEqual(["First", "Second!"]);
  });

  it("restores a reply draft when replying to the thread again", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    handlers.save_draft = () => ({ id: "d7" });
    localStorage.setItem("draft_reply_a_t-a#old", JSON.stringify({
      to: "ana@x.com", cc: "", bcc: "", subject: "Re: Hi", body: "my saved reply", threadId: "t-a", gmailDraftId: "d7", savedAt: 5,
    }));
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m1");
    fireEvent.keyDown(document, { key: "r" });

    const body = await screen.findByPlaceholderText("Write your reply...");
    expect(body).toHaveValue("my saved reply");
    fireEvent.input(body, { target: { value: "my saved reply, edited" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Write your reply..."), { key: "Escape" });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_draft", expect.objectContaining({ draftId: "d7", body: "my saved reply, edited" })));
    expect(storedDrafts("draft_reply_a_t-a")).toEqual([expect.objectContaining({ body: "my saved reply, edited" })]);
  });

  it("does not let the closed reply's Discard delete the draft a reopened reply continues", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    handlers.save_draft = () => ({ id: "d7" });
    handlers.delete_draft = () => null;
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m1");
    fireEvent.keyDown(document, { key: "r" });
    fireEvent.input(await screen.findByPlaceholderText("Write your reply..."), { target: { value: "half a reply" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Write your reply..."), { key: "Escape" });
    await screen.findByRole("button", { name: "Discard" });
    await new Promise(r => setTimeout(r, 250));

    fireEvent.keyDown(document, { key: "r" });
    expect(await screen.findByPlaceholderText("Write your reply...")).toHaveValue("half a reply");
    const discard = screen.queryByRole("button", { name: "Discard" });
    if (discard) fireEvent.click(discard);
    await new Promise(r => setTimeout(r, 50));

    expect(invoke).not.toHaveBeenCalledWith("delete_draft", expect.anything());
    expect(storedDrafts("draft_reply_a_t-a")).toEqual([expect.objectContaining({ body: expect.stringContaining("half a reply") })]);
  });
});

describe("App inline reply", () => {
  it("keeps the same text box while typing", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m1");
    fireEvent.keyDown(document, { key: "r" });

    const body = await screen.findByPlaceholderText("Write your reply...");
    fireEvent.input(body, { target: { value: "typing" } });
    expect(body.isConnected).toBe(true);
    expect(screen.getByPlaceholderText("Write your reply...")).toBe(body);
  });
});

describe("App layout removal", () => {
  it("asks before deleting a card and keeps it when cancelled", async () => {
    handlers.delete_card = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.click(screen.getByTitle("Edit query"));
    fireEvent.click(await screen.findByRole("button", { name: /Delete/ }));
    await answerConfirm(false, /Alpha/);
    await new Promise(r => setTimeout(r, 20));

    expect(invoke).not.toHaveBeenCalledWith("delete_card", expect.anything());
    expect(screen.getByRole("region", { name: "Alpha email card" })).toBeInTheDocument();
  });

  it("deletes a card once confirmed", async () => {
    handlers.delete_card = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.click(screen.getByTitle("Edit query"));
    fireEvent.click(await screen.findByRole("button", { name: /Delete/ }));
    await answerConfirm(true);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_card", { id: "card-a" }));
  });

  it("asks before starting from scratch and keeps the restored layout when cancelled", async () => {
    handlers.get_accounts = () => [];
    handlers.run_oauth_flow = () => account("a", "a@x.com");
    handlers.pull_from_icloud = () => true;
    handlers.delete_card = () => null;
    render(() => <App />);
    fireEvent.click(await screen.findByText("Sign in with Google"));
    fireEvent.click(await screen.findByText("Start from scratch"));
    // Deleting a card syncs through iCloud; the user must know it isn't local
    await answerConfirm(false, /1 card.*other Macs/);
    await new Promise(r => setTimeout(r, 20));

    expect(invoke).not.toHaveBeenCalledWith("delete_card", expect.anything());
    expect(screen.getByText("Start from scratch")).toBeInTheDocument();
  });

  it("asks before signing out and keeps the account when cancelled", async () => {
    handlers.delete_account = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.click(screen.getByText("Sign out"));
    await answerConfirm(false, /a@x\.com/);
    await new Promise(r => setTimeout(r, 20));

    expect(invoke).not.toHaveBeenCalledWith("delete_account", expect.anything());
    expect(screen.getByText("Mail for A")).toBeInTheDocument();
  });

  it("archives several threads once confirmed, and none when cancelled", async () => {
    localStorage.setItem("actionSettings", JSON.stringify({ archive: true }));
    threadsByCard["card-a"] = [{ ...thread("t-1", "One"), labels: ["INBOX"] }, { ...thread("t-2", "Two"), labels: ["INBOX"] }];
    handlers.modify_threads = () => null;
    render(() => <App />);
    await screen.findByText("One");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "x" });

    fireEvent.click(await screen.findByTitle("Archive"));
    await answerConfirm(false, /Archive 2 threads/);
    await new Promise(r => setTimeout(r, 20));
    expect(invoke).not.toHaveBeenCalledWith("modify_threads", expect.anything());

    fireEvent.click(await screen.findByTitle("Archive"));
    await answerConfirm(true);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("modify_threads", expect.objectContaining({ threadIds: ["t-1", "t-2"] })));
  });

  it("signs out once confirmed in the app's own dialog", async () => {
    handlers.delete_account = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.click(screen.getByText("Sign out"));
    await answerConfirm(true);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_account", expect.objectContaining({ accountId: "a" })));
  });

  it("removes the signed-out account's local drafts", async () => {
    handlers.get_accounts = () => [account("a", "a@x.com"), account("b", "b@x.com")];
    handlers.delete_account = () => null;
    localStorage.setItem("draft_new_a#1", JSON.stringify({ to: "", cc: "", bcc: "", subject: "secret", body: "", savedAt: 1 }));
    localStorage.setItem("draft_new_b#1", JSON.stringify({ to: "", cc: "", bcc: "", subject: "keep", body: "", savedAt: 1 }));
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.click(screen.getByText("Sign out"));
    await answerConfirm(true);

    await screen.findByText("Mail for B");
    expect(localStorage.getItem("draft_new_a#1")).toBeNull();
    expect(localStorage.getItem("draft_new_b#1")).not.toBeNull();
  });
});

describe("App shortcuts behind overlays", () => {
  it("does not act on the focused thread while the shortcuts help is open", async () => {
    handlers.modify_threads = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "?" });
    await screen.findByText("Keyboard Shortcuts");
    fireEvent.keyDown(document, { key: "d" });
    fireEvent.keyDown(document, { key: "c" });
    await new Promise(r => setTimeout(r, 20));

    expect(invoke).not.toHaveBeenCalledWith("modify_threads", expect.anything());
    expect(document.querySelector(".compose-panel")).toBeNull();
  });

  it("does not act on the focused thread while Settings is open", async () => {
    handlers.modify_threads = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.click(screen.getByTitle("a@x.com"));
    await waitFor(() => expect(document.querySelector(".account-chooser-container")).toHaveTextContent("Settings"));
    fireEvent.click(within(document.querySelector(".account-chooser-container") as HTMLElement).getByText("Settings"));
    await waitFor(() => expect(document.querySelector(".settings-sidebar.open")).not.toBeNull());
    fireEvent.keyDown(document, { key: "a" });
    await new Promise(r => setTimeout(r, 20));

    expect(invoke).not.toHaveBeenCalledWith("modify_threads", expect.anything());
  });

  it("closes the shortcuts help before an open compose on Escape", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "c" });
    await screen.findByPlaceholderText("Subject");
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document, { key: "?" });
    await screen.findByText("Keyboard Shortcuts");
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByText("Keyboard Shortcuts")).not.toBeInTheDocument());
    await new Promise(r => setTimeout(r, 300));
    expect(document.querySelector(".compose-panel")).not.toBeNull();
  });
});

describe("App undo", () => {
  it("unstars only the threads a bulk star starred", async () => {
    handlers.modify_threads = () => null;
    threadsByCard["card-a"] = [
      { ...thread("t-1", "Already starred"), labels: ["INBOX", "STARRED"] },
      { ...thread("t-2", "Not starred"), labels: ["INBOX"] },
    ];
    render(() => <App />);
    await screen.findByText("Already starred");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.click(await screen.findByTitle("Star"));
    await screen.findByText("Starred 2 threads");
    invoke.mockClear();
    fireEvent.click(screen.getByText("Undo"));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("modify_threads", {
      accountId: "a", threadIds: ["t-2"], addLabels: [], removeLabels: ["STARRED"],
    }));
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "modify_threads")).toHaveLength(1);
  });
});

describe("App iCloud cards", () => {
  it("shows cards changed on another Mac when the window regains focus", async () => {
    render(() => <App />);
    expect(await screen.findByRole("region", { name: "Alpha email card" })).toBeInTheDocument();

    handlers.pull_from_icloud = () => true;
    cardsByAccount.a = [...cardsByAccount.a, { ...card("card-new", "a", "From my laptop"), position: 5 }];
    fireEvent.focus(window);

    expect(await screen.findByRole("region", { name: "From my laptop email card" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Alpha email card" })).toBeInTheDocument();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("fetch_threads_paginated", expect.objectContaining({ cardId: "card-new" })));
  });

  it("leaves unchanged cards' columns and scroll positions alone when another Mac changes a card", async () => {
    cardsByAccount.a = [card("card-a", "a", "Alpha"), { ...card("card-b", "a", "Beta"), position: 1 }];
    handlers.get_cards = ({ accountId }) => structuredClone(cardsByAccount[accountId as string] ?? []);
    render(() => <App />);
    await screen.findByText("Mail for A");
    const alpha = screen.getByRole("region", { name: "Alpha email card" });
    const body = alpha.querySelector(".card-body") as HTMLElement;
    body.scrollTop = 120;

    handlers.pull_from_icloud = () => true;
    cardsByAccount.a = [cardsByAccount.a[0], { ...cardsByAccount.a[1], name: "Beta renamed" }];
    fireEvent.focus(window);

    expect(await screen.findByRole("region", { name: "Beta renamed email card" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Alpha email card" })).toBe(alpha);
    expect(body.scrollTop).toBe(120);
  });

  it("fetches a card whose query changed on another Mac instead of showing the old query's cache", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    handlers.pull_from_icloud = () => true;
    cardsByAccount.a = [{ ...card("card-a", "a", "Alpha"), query: "is:starred" }];
    invoke.mockClear();
    fireEvent.focus(window);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("fetch_threads_paginated", expect.objectContaining({ cardId: "card-a" })));
    expect(invoke).not.toHaveBeenCalledWith("get_cached_card_threads", expect.anything());
  });

  it("forgets a card deleted on another Mac", async () => {
    const shared = { ...thread("t-s", "In both cards"), labels: ["INBOX"] };
    cardsByAccount.a = [card("card-a", "a", "Alpha"), { ...card("card-b", "a", "Beta"), position: 1 }];
    threadsByCard["card-a"] = [shared];
    threadsByCard["card-b"] = [shared, { ...thread("t-b", "Unread in B"), unread_count: 1 }];
    handlers.modify_threads = () => null;
    render(() => <App />);
    await screen.findByText("Unread in B");
    await waitFor(() => expect(setBadgeCount).toHaveBeenLastCalledWith(1));

    handlers.pull_from_icloud = () => true;
    cardsByAccount.a = [card("card-a", "a", "Alpha")];
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Beta email card" })).not.toBeInTheDocument());
    await waitFor(() => expect(setBadgeCount).toHaveBeenLastCalledWith(undefined));

    invoke.mockClear();
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "a" });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_cached_card_threads", expect.objectContaining({ cardId: "card-a" })));
    expect(invoke).not.toHaveBeenCalledWith("save_cached_card_threads", expect.objectContaining({ cardId: "card-b" }));
  });

  it("keeps the cards as they are when iCloud can't be reached", async () => {
    render(() => <App />);
    await screen.findByRole("region", { name: "Alpha email card" });
    handlers.pull_from_icloud = () => { throw new Error("iCloud unavailable"); };
    invoke.mockClear();
    fireEvent.focus(window);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("pull_from_icloud", undefined));
    expect(invoke.mock.calls.some(([cmd]) => cmd === "get_cards")).toBe(false);
    expect(screen.getByRole("region", { name: "Alpha email card" })).toBeInTheDocument();
  });
});

describe("App forward from a card", () => {
  it("names the forwarded message's recipients", async () => {
    handlers.get_thread_details = () => ({
      id: "t-a",
      messages: [fullMessage("m1", "Ana <ana@x.com>", {
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: "Ana <ana@x.com>" },
            { name: "To", value: "Bo <bo@x.com>" },
            { name: "Cc", value: "cy@x.com" },
            { name: "Subject", value: "Hi" },
          ],
          body: { size: 0 },
        },
      })],
    });
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "f" });

    const body = await waitFor(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(".compose-panel textarea");
      expect(textarea?.value).toContain("Forwarded message");
      return textarea!.value;
    });
    expect(body).toContain("To: Bo <bo@x.com>");
    expect(body).toContain("Cc: cy@x.com");
  });

  it("says so when it can only forward the preview of an email it couldn't load", async () => {
    threadsByCard["card-a"] = [{ ...thread("t-a", "Mail for A"), snippet: "Just the preview" }];
    handlers.get_thread_details = () => { throw "Request failed: could not reach Gmail. Check your connection."; };
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "f" });

    expect(await screen.findByText("Couldn't load the whole email, so only its preview is quoted")).toBeInTheDocument();
    expect(document.querySelector<HTMLTextAreaElement>(".compose-panel textarea")!.value).toContain("Just the preview");
  });
});

describe("App links", () => {
  function clickLink(href: string, inside?: string, onClick?: (e: MouseEvent) => void) {
    const container = document.createElement("div");
    if (inside) container.className = inside;
    const link = document.createElement("a");
    link.setAttribute("href", href);
    link.textContent = "link";
    if (onClick) link.addEventListener("click", onClick);
    container.appendChild(link);
    document.body.appendChild(container);
    const notCancelled = fireEvent.click(link);
    container.remove();
    return notCancelled;
  }

  it("opens web links in the browser", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    expect(clickLink("https://example.com/a", "message-body")).toBe(false);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/a");
  });

  it("opens a mailto link as a new email", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    expect(clickLink("mailto:bo@y.com?subject=Hi%20there", "message-body")).toBe(false);

    await waitFor(() => expect(screen.getByPlaceholderText("Recipients")).toHaveValue("bo@y.com"));
    expect(screen.getByPlaceholderText("Subject")).toHaveValue("Hi there");
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("leaves the app's own links to their handlers", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    clickLink("#", undefined, e => e.preventDefault());
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("does not follow a relative link in an email", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    expect(clickLink("/unsubscribe", "message-body")).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe("App new card form", () => {
  it("starts empty again after a cancelled card", async () => {
    handlers.search_threads_preview = () => [];
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.click(screen.getByTitle("New card"));
    fireEvent.input(screen.getByPlaceholderText("Inbox, Starred..."), { target: { value: "Temp" } });
    fireEvent.click(screen.getByTitle("Cancel (Esc)"));
    await waitFor(() => expect(screen.queryByPlaceholderText("Inbox, Starred...")).not.toBeInTheDocument());

    fireEvent.click(screen.getByTitle("New card"));
    expect(screen.getByPlaceholderText("Inbox, Starred...")).toHaveValue("");
  });
});

describe("App card order", () => {
  function dragFirstCardOntoSecond() {
    const wrappers = Array.from(document.querySelectorAll(".card-wrapper")) as HTMLElement[];
    wrappers.forEach((el, i) => {
      el.getBoundingClientRect = () => DOMRect.fromRect({ x: i * 320, y: 0, width: 300, height: 600 });
    });
    const pointer = (type: string, x: number) => new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 10 });
    wrappers[0].querySelector(".card-header")!.dispatchEvent(pointer("pointerdown", 10));
    document.dispatchEvent(pointer("pointermove", 200));
    document.dispatchEvent(pointer("pointermove", 400));
    document.dispatchEvent(pointer("pointerup", 400));
  }

  it("moves the dragged card's column instead of rebuilding every card", async () => {
    cardsByAccount.a = [card("card-a", "a", "Alpha"), { ...card("card-b", "a", "Beta"), position: 1 }];
    handlers.reorder_cards = () => null;
    render(() => <App />);
    const beta = await screen.findByRole("region", { name: "Beta email card" });
    const alpha = screen.getByRole("region", { name: "Alpha email card" });
    dragFirstCardOntoSecond();

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("reorder_cards", { orders: [["card-b", 0], ["card-a", 1]] }));
    const names = Array.from(document.querySelectorAll(".card-title")).map(el => el.textContent);
    expect(names).toEqual(["Beta", "Alpha"]);
    expect(screen.getByRole("region", { name: "Alpha email card" })).toBe(alpha);
    expect(screen.getByRole("region", { name: "Beta email card" })).toBe(beta);
  });

  it("says so when a dragged card's new place can't be saved, and puts it back", async () => {
    cardsByAccount.a = [card("card-a", "a", "Alpha"), { ...card("card-b", "a", "Beta"), position: 1 }];
    handlers.reorder_cards = () => { throw new Error("db locked"); };
    render(() => <App />);
    await screen.findByRole("region", { name: "Beta email card" });
    dragFirstCardOntoSecond();

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("reorder_cards", expect.anything()));
    expect(await screen.findByText(/Couldn't save the card order/)).toBeInTheDocument();
    const names = Array.from(document.querySelectorAll(".card-title")).map(el => el.textContent);
    expect(names).toEqual(["Alpha", "Beta"]);
  });
});

describe("App card query edits", () => {
  it("does not let a refresh started before the edit show or cache the old query's threads", async () => {
    let calls = 0;
    let releaseOld!: () => void;
    const slowOld = new Promise<void>(r => { releaseOld = r; });
    handlers.fetch_threads_paginated = async () => {
      const call = ++calls;
      if (call === 2) await slowOld;
      const subject = call === 1 ? "Mail for A" : call === 2 ? "Old query result" : "New query result";
      return { groups: [{ label: "Today", threads: [thread(`t${call}`, subject)] }], next_page_token: null, has_more: false };
    };
    handlers.update_card = () => null;
    handlers.clear_card_cache = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    await waitFor(() => expect(screen.getByTitle("Refresh")).not.toBeDisabled());

    fireEvent.click(screen.getByTitle("Refresh"));
    await waitFor(() => expect(calls).toBe(2));
    fireEvent.click(screen.getByTitle("Edit query"));
    fireEvent.input(screen.getByPlaceholderText("is:inbox, from:boss, newer_than:7d"), { target: { value: "is:starred" } });
    fireEvent.click(screen.getByTitle("Save (⌘Enter)"));
    await screen.findByText("New query result");

    releaseOld();
    await new Promise(r => setTimeout(r, 30));
    expect(screen.getByText("New query result")).toBeInTheDocument();
    expect(screen.queryByText("Old query result")).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("save_cached_card_threads", expect.objectContaining({
      groups: [expect.objectContaining({ threads: [expect.objectContaining({ subject: "Old query result" })] })],
    }));
  });
});

describe("App card editor and iCloud", () => {
  it("saves only what was edited, keeping a query another Mac changed meanwhile", async () => {
    handlers.update_card = () => null;
    handlers.clear_card_cache = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.click(screen.getByTitle("Edit query"));
    fireEvent.input(screen.getByPlaceholderText("Inbox, Starred..."), { target: { value: "Alpha renamed" } });

    handlers.pull_from_icloud = () => true;
    cardsByAccount.a = [{ ...card("card-a", "a", "Alpha"), query: "is:starred" }];
    fireEvent.focus(window);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_cards", { accountId: "a" }));
    await waitFor(() => expect(screen.getByPlaceholderText("is:inbox, from:boss, newer_than:7d")).toHaveValue("is:starred"));
    expect(screen.getByPlaceholderText("Inbox, Starred...")).toHaveValue("Alpha renamed");
    await new Promise(r => setTimeout(r, 20));
    invoke.mockClear();
    fireEvent.click(screen.getByTitle("Save (⌘Enter)"));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("update_card", {
      card: expect.objectContaining({ id: "card-a", name: "Alpha renamed", query: "is:starred" }),
    }));
    expect(invoke).not.toHaveBeenCalledWith("clear_card_cache", expect.anything());
  });
});

describe("App card refreshes", () => {
  it("does not fetch a card again while its refresh is in flight", async () => {
    handlers.get_cached_card_threads = () => ({ groups: [{ label: "Today", threads: [thread("t-a", "Mail for A")] }], next_page_token: null, cached_at: 1 });
    let release!: () => void;
    const slow = new Promise<void>(r => { release = r; });
    const fetchPage = handlers.fetch_threads_paginated;
    handlers.fetch_threads_paginated = async (args) => { await slow; return fetchPage(args); };
    handlers.sync_threads_incremental = () => ({ modified_threads: [], deleted_thread_ids: [], is_full_sync: true });
    const fetches = () => invoke.mock.calls.filter(([cmd]) => cmd === "fetch_threads_paginated").length;
    render(() => <App />);
    await screen.findByText("Mail for A");
    await waitFor(() => expect(fetches()).toBe(1));

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sync_threads_incremental", { accountId: "a" }));
    await new Promise(r => setTimeout(r, 20));
    expect(fetches()).toBe(1);

    release();
    await waitFor(() => expect(fetches()).toBe(2));
    await new Promise(r => setTimeout(r, 20));
    expect(fetches()).toBe(2);
  });
});

describe("App background sync refetches", () => {
  it("does not refetch cards for a thread that only moved to spam", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    await new Promise(r => setTimeout(r, 20));
    const fetches = () => invoke.mock.calls.filter(([cmd]) => cmd === "fetch_threads_paginated").length;
    const before = fetches();

    handlers.sync_threads_incremental = () => ({
      modified_threads: [{ ...thread("t-spam", "Junk"), labels: ["SPAM", "UNREAD"] }],
      deleted_thread_ids: [],
      is_full_sync: false,
    });
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sync_threads_incremental", { accountId: "a" }));
    await new Promise(r => setTimeout(r, 30));

    expect(fetches()).toBe(before);
  });

  it("refetches cards for new mail no card shows yet", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    await new Promise(r => setTimeout(r, 20));
    const fetches = () => invoke.mock.calls.filter(([cmd]) => cmd === "fetch_threads_paginated").length;
    const before = fetches();

    handlers.sync_threads_incremental = () => ({
      modified_threads: [{ ...thread("t-new", "New"), labels: ["INBOX", "UNREAD"] }],
      deleted_thread_ids: [],
      is_full_sync: false,
    });
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(fetches()).toBe(before + 1));
  });
});

describe("App iCloud sync status", () => {
  beforeEach(() => {
    handlers.get_accounts = () => [];
    handlers.get_stored_credentials = () => null;
  });
  const openSettings = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    return document.querySelector(".settings-sidebar")!;
  };

  it("says in Settings why card sync with iCloud isn't working", async () => {
    handlers.get_icloud_sync_status = () => ({ available: true, last_synced_at: null, last_error: "iCloud refused the card backup" });
    render(() => <App />);
    const settings = await openSettings();
    await waitFor(() => expect(settings).toHaveTextContent("iCloud sync: not working, iCloud refused the card backup"));
  });

  it("says when card sync last reached iCloud, asking again each time Settings opens", async () => {
    handlers.get_icloud_sync_status = () => ({ available: true, last_synced_at: Date.now() - 5.5 * 60_000, last_error: null });
    render(() => <App />);
    const settings = await openSettings();
    await waitFor(() => expect(settings).toHaveTextContent("iCloud sync: on, last synced 5m ago"));

    fireEvent.click(document.querySelector(".settings-overlay")!);
    handlers.get_icloud_sync_status = () => ({ available: false, last_synced_at: null, last_error: null });
    await openSettings();
    await waitFor(() => expect(settings).toHaveTextContent("iCloud sync: not available in this build"));
  });
});

describe("App full sync", () => {
  it("refetches a card that was collapsed during a full sync once it is expanded", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    const fetches = () => invoke.mock.calls.filter(([cmd, args]) => cmd === "fetch_threads_paginated" && (args as { cardId: string }).cardId === "card-a").length;
    await waitFor(() => expect(fetches()).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Collapse Alpha" }));
    await screen.findByRole("button", { name: "Expand Alpha" });

    handlers.sync_threads_incremental = () => ({ modified_threads: [], deleted_thread_ids: [], is_full_sync: true });
    threadsByCard["card-a"] = [thread("t-new", "Arrived during the reset")];
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sync_threads_incremental", { accountId: "a" }));
    await new Promise(r => setTimeout(r, 20));
    expect(fetches()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Expand Alpha" }));
    expect(await screen.findByText("Arrived during the reset")).toBeInTheDocument();
    expect(fetches()).toBe(2);
  });
});

describe("App dock badge", () => {
  it("updates the badge only when the unread count changes", async () => {
    threadsByCard["card-a"] = [{ ...thread("t-a", "Mail for A"), unread_count: 1 }];
    handlers.sync_threads_incremental = () => ({ modified_threads: [], deleted_thread_ids: [], is_full_sync: true });
    render(() => <App />);
    await screen.findByText("Mail for A");
    await waitFor(() => expect(setBadgeCount).toHaveBeenLastCalledWith(1));
    await new Promise(r => setTimeout(r, 20));
    const calls = setBadgeCount.mock.calls.length;
    const fetches = () => invoke.mock.calls.filter(([cmd]) => cmd === "fetch_threads_paginated").length;
    const fetchesBefore = fetches();

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(fetches()).toBe(fetchesBefore + 1));
    await new Promise(r => setTimeout(r, 30));
    expect(setBadgeCount.mock.calls.length).toBe(calls);

    threadsByCard["card-a"] = [{ ...thread("t-a", "Mail for A"), unread_count: 1 }, { ...thread("t-b", "More"), unread_count: 2 }];
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(setBadgeCount).toHaveBeenLastCalledWith(2));
  });
});

describe("App thread rows", () => {
  const rowOf = (subject: string) => screen.getByText(subject).closest(".thread");

  it("keeps a thread's row when a background refresh brings it back unchanged", async () => {
    threadsByCard["card-a"] = [thread("t-a", "Mail for A"), thread("t-b", "Other mail")];
    handlers.sync_threads_incremental = () => ({ modified_threads: [], deleted_thread_ids: [], is_full_sync: true });
    render(() => <App />);
    await screen.findByText("Mail for A");
    const row = rowOf("Other mail");
    const fetches = () => invoke.mock.calls.filter(([cmd]) => cmd === "fetch_threads_paginated").length;
    const before = fetches();

    threadsByCard["card-a"] = [thread("t-new", "Brand new"), thread("t-a", "Mail for A"), thread("t-b", "Other mail")];
    window.dispatchEvent(new Event("focus"));
    await screen.findByText("Brand new");
    expect(fetches()).toBe(before + 1);

    expect(rowOf("Other mail")).toBe(row);
  });

  it("keeps thread rows while the filter narrows the list", async () => {
    threadsByCard["card-a"] = [thread("t-a", "Mail for A"), thread("t-b", "Other mail")];
    render(() => <App />);
    await screen.findByText("Mail for A");
    const row = rowOf("Other mail");

    fireEvent.keyDown(document, { key: "/" });
    const filter = await screen.findByPlaceholderText(/Filter/i);
    fireEvent.input(filter, { target: { value: "o" } });
    await waitFor(() => expect(rowOf("Other mail")).not.toBeNull());
    fireEvent.input(filter, { target: { value: "ot" } });
    await waitFor(() => expect(screen.queryByText("Mail for A")).not.toBeInTheDocument());

    expect(rowOf("Other mail")).toBe(row);
  });

  it("sends a refreshed card back to the cache only when it changed", async () => {
    handlers.sync_threads_incremental = () => ({ modified_threads: [], deleted_thread_ids: [], is_full_sync: true });
    render(() => <App />);
    await screen.findByText("Mail for A");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_cached_card_threads", expect.anything()));
    const saves = () => invoke.mock.calls.filter(([cmd]) => cmd === "save_cached_card_threads").length;
    const fetches = () => invoke.mock.calls.filter(([cmd]) => cmd === "fetch_threads_paginated").length;
    const savesBefore = saves();
    const fetchesBefore = fetches();

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(fetches()).toBe(fetchesBefore + 1));
    await new Promise(r => setTimeout(r, 30));
    expect(saves()).toBe(savesBefore);

    threadsByCard["card-a"] = [thread("t-new", "Brand new"), thread("t-a", "Mail for A")];
    window.dispatchEvent(new Event("focus"));
    await screen.findByText("Brand new");
    await waitFor(() => expect(saves()).toBe(savesBefore + 1));

    // The cache's time is the card's "Last synced" at the next start, so an
    // unchanged card is still written now and then
    const later = Date.now() + 6 * 60 * 1000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => later);
    onTestFinished(() => clock.mockRestore());
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(saves()).toBe(savesBefore + 2));
  });

  it("does not regroup a card to move focus, hover a row or type a quick reply", async () => {
    threadsByCard["card-a"] = Array.from({ length: 30 }, (_, i) => thread(`t${i}`, `Mail ${i}`));
    render(() => <App />);
    await screen.findByText("Mail 29");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "r" });
    const input = document.querySelector(".quick-reply-input") as HTMLTextAreaElement;
    regroupThreads.calls = 0;

    fireEvent.input(input, { target: { value: "T" } });
    fireEvent.input(input, { target: { value: "Th" } });
    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "k" });
    fireEvent.mouseEnter(rowOf("Mail 5")!);

    expect(regroupThreads.calls).toBe(0);
    expect(rowOf("Mail 1")).toHaveClass("focused");
  });
});

describe("App thread load errors", () => {
  it("says why a thread could not be opened", async () => {
    handlers.get_thread_details = () => { throw "API error 404 Not Found: gone"; };
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
  });

  it("offers to sign in again when opening a thread finds the session expired", async () => {
    handlers.get_thread_details = () => { throw 'Token refresh failed: {"error": "invalid_grant"}'; };
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    expect(await screen.findByText(/Sign in again to load this email/)).toBeInTheDocument();
    const banner = document.querySelector(".auth-error") as HTMLElement;
    expect(within(banner).getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  });
});

describe("App title bar", () => {
  it("leaves dragging and double-click zoom to Tauri's drag region", async () => {
    startDragging.mockClear();
    render(() => <App />);
    await screen.findByText("Mail for A");
    const region = document.querySelector(".drag-region") as HTMLElement;
    expect(region).toHaveAttribute("data-tauri-drag-region");

    // Tauri's own handler starts left-button drags and zooms on a
    // double-click; a handler of the app's would drag on every button
    fireEvent.mouseDown(region, { button: 2 });
    fireEvent.mouseDown(region, { button: 0, detail: 2 });
    expect(startDragging).not.toHaveBeenCalled();
  });
});

describe("App Google API settings", () => {
  it("labels the credential fields and says which client and APIs to set up", async () => {
    handlers.get_accounts = () => [];
    handlers.get_stored_credentials = () => null;
    render(() => <App />);
    fireEvent.click(await screen.findByText("Settings"));

    expect(screen.getByLabelText("Client ID")).toHaveAttribute("placeholder", "xxxx.apps.googleusercontent.com");
    expect(screen.getByLabelText("Client Secret")).toHaveAttribute("type", "password");
    const hints = Array.from(document.querySelectorAll(".settings-hint")).map(el => el.textContent).join(" ");
    expect(hints).toMatch(/Desktop app/);
    expect(hints).toMatch(/Gmail API.*Google Calendar API.*People API/);
    // A Desktop app client has no redirect URI to set
    expect(hints).not.toMatch(/Redirect URI/);
    expect(hints).toMatch(/port 8420/);
  });

  it("links to the Cloud Console's credentials page as a real link", async () => {
    handlers.get_accounts = () => [];
    handlers.get_stored_credentials = () => null;
    render(() => <App />);
    fireEvent.click(await screen.findByText("Settings"));
    const link = screen.getByRole("link", { name: "Open Google Cloud Console" });

    expect(link).toHaveAttribute("href", "https://console.cloud.google.com/apis/credentials");
    fireEvent.click(link);
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith("https://console.cloud.google.com/apis/credentials");
  });
});

describe("App accessibility", () => {
  it("lists every thread-list shortcut in the help", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "?" });
    const help = (await screen.findByText("Keyboard Shortcuts")).closest(".shortcuts-modal") as HTMLElement;

    for (const text of ["Previous card", "Next card", "Undo last action", "New event"]) {
      expect(within(help).getByText(text)).toBeInTheDocument();
    }
    expect(within(help).getByText("#")).toBeInTheDocument();
  });

  it("lists the open thread's actions and the open event's shortcuts in the help", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "?" });
    const help = (await screen.findByText("Keyboard Shortcuts")).closest(".shortcuts-modal") as HTMLElement;
    const section = (title: string) => within(help).getByRole("heading", { name: title }).closest(".shortcuts-section") as HTMLElement;

    expect(within(help).getByText("Open thread or event")).toBeInTheDocument();
    for (const text of ["Archive", "Star", "Toggle read", "Toggle important", "Report spam", "Delete"]) {
      expect(within(section("Open thread")).getByText(text)).toBeInTheDocument();
    }
    for (const text of ["Reply to organizer", "Reply all", "Forward", "Join meeting", "Open in Google Calendar", "Move to calendar", "Edit", "Delete"]) {
      expect(within(section("Open event")).getByText(text)).toBeInTheDocument();
    }
  });

  it("names the collapse button and says whether the card is expanded", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    const button = screen.getByRole("button", { name: "Collapse Alpha" });
    expect(button).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: "Expand Alpha" })).toHaveAttribute("aria-expanded", "false"));
  });

  it("picks a background colour from the keyboard", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    const picker = screen.getByRole("button", { name: "Choose background color" });
    expect(picker).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(picker, { key: "Enter" });
    expect(picker).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(screen.getByRole("button", { name: "Blue" }), { key: " " });
    expect(localStorage.getItem("bgColorIndex")).toBe("5");
    expect(picker).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "No color", hidden: true })).toBeInTheDocument();
  });

  it("shows the saved background colour on a deck that appears after the first sign-in", async () => {
    localStorage.setItem("bgColorIndex", "5");
    handlers.get_accounts = () => [];
    handlers.run_oauth_flow = () => account("a", "a@x.com");
    handlers.pull_from_icloud = () => true;
    render(() => <App />);
    const signIn = await screen.findByText("Sign in with Google");
    // The user takes a moment; startup is long done
    await new Promise(r => setTimeout(r, 50));
    fireEvent.click(signIn);
    fireEvent.click(await screen.findByText("Continue"));

    await waitFor(() => expect((document.querySelector(".deck") as HTMLElement).style.background).toContain("30, 136, 229"));
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#1E88E5");
  });

  it("follows the system's dark mode with the chosen background colour", async () => {
    const listeners: ((e: { matches: boolean }) => void)[] = [];
    const media = { matches: false, addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.push(l), removeEventListener: () => {} };
    const matchMedia = vi.fn(() => media);
    Object.defineProperty(window, "matchMedia", { value: matchMedia, configurable: true });
    onTestFinished(() => { delete (window as { matchMedia?: unknown }).matchMedia; });
    localStorage.setItem("bgColorIndex", "5");
    render(() => <App />);
    await screen.findByText("Mail for A");
    await waitFor(() => expect((document.querySelector(".deck") as HTMLElement).style.background).toContain("0.18"));

    media.matches = true;
    listeners.forEach(l => l({ matches: true }));
    await waitFor(() => expect((document.querySelector(".deck") as HTMLElement).style.background).toContain("0.25"));
    expect(document.documentElement.style.getPropertyValue("--app-bg")).toContain("0.25");
  });

  it("says the account button opens a menu and whether it is open", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    const avatar = screen.getByTitle("a@x.com");
    expect(avatar).toHaveAttribute("aria-haspopup", "menu");
    expect(avatar).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(avatar);
    expect(avatar).toHaveAttribute("aria-expanded", "true");
  });

  it("starts an email to a suggested contact from the keyboard", async () => {
    handlers.fetch_contacts = () => [{ resource_name: "people/1", display_name: "Bo", email_addresses: ["bo@y.com"], photo_url: null }];
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.focusIn(screen.getByRole("button", { name: "Compose new email" }));
    const suggestion = await screen.findByRole("button", { name: "New email to Bo" });
    expect(suggestion).toHaveAttribute("tabindex", "0");
    expect(suggestion.closest(".compose-suggestions")).toHaveClass("visible");
    fireEvent.keyDown(suggestion, { key: "Enter" });

    await waitFor(() => expect(screen.getByPlaceholderText("Recipients")).toHaveValue("bo@y.com"));
  });

  it("ranks contacts only when suggestions are wanted, not on every mail change", async () => {
    threadsByCard["card-a"] = [{ ...thread("t-a", "Mail for A"), participants: ["Ana <ana@x.com>"], unread_count: 1, labels: ["INBOX", "UNREAD"] }];
    handlers.modify_threads = () => null;
    handlers.get_thread_details = () => ({ id: "t-a", messages: [] });
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("modify_threads", expect.anything()));
    fireEvent.keyDown(document, { key: "Escape" });
    await new Promise(r => setTimeout(r, 20));
    expect(rankContacts.calls).toBe(0);

    fireEvent.mouseEnter(document.querySelector(".compose-btn-wrapper")!);
    expect(await screen.findByRole("button", { name: "New email to Ana" })).toBeInTheDocument();
  });
});

describe("App card query autocomplete", () => {
  it("suggests the account's labels after label:", async () => {
    handlers.list_labels = () => [
      { id: "L1", name: "Travel", label_type: "user", messageListVisibility: null, labelListVisibility: null },
      { id: "INBOX", name: "INBOX", label_type: "system", messageListVisibility: null, labelListVisibility: null },
    ];
    handlers.search_threads_preview = () => [];
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.click(screen.getByTitle("New card"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_labels", { accountId: "a" }));
    await new Promise(r => setTimeout(r, 10));
    const query = screen.getAllByPlaceholderText("is:inbox, from:boss, newer_than:7d").slice(-1)[0];
    fireEvent.focus(query);
    fireEvent.input(query, { target: { value: "label:tr" } });

    const suggestion = await screen.findByText("label:travel");
    expect(suggestion.closest(".query-autocomplete")).not.toBeNull();
    expect(screen.queryByText("label:inbox")).not.toBeInTheDocument();
  });
});

describe("App new card preview", () => {
  it("previews a few of a calendar query's events, like an email query's threads", async () => {
    handlers.list_labels = () => [];
    handlers.fetch_calendar_events = () => Array.from({ length: 40 }, (_, i) => calendarEvent(`ev-${i}`, `Meeting ${i}`));
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.click(screen.getByTitle("New card"));
    const query = screen.getAllByPlaceholderText("is:inbox, from:boss, newer_than:7d").slice(-1)[0];
    fireEvent.input(query, { target: { value: "calendar:7d" } });

    expect(await screen.findByText("Meeting 0")).toBeInTheDocument();
    expect(screen.queryByText("Meeting 5")).not.toBeInTheDocument();
    expect(screen.getByText("+35 more")).toBeInTheDocument();
  });
});

describe("App label drawer", () => {
  it("says the labels could not be loaded and loads them again on retry", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    let fail = true;
    handlers.list_labels = () => {
      if (fail) throw new Error("offline");
      return [{ id: "Label_7", name: "Receipts", messageListVisibility: null, labelListVisibility: null, label_type: "user" }];
    };
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m1");
    fireEvent.keyDown(document, { key: "l" });

    expect(await screen.findByText(/Couldn't load labels/)).toBeInTheDocument();
    expect(screen.queryByText("No labels found")).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Receipts")).toBeInTheDocument();
  });

  it("shows a label made in Gmail since the drawer was last open, keeping the list meanwhile", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    const label = (id: string, name: string) => ({ id, name, messageListVisibility: null, labelListVisibility: null, label_type: "user" });
    let labels = [label("L1", "Receipts")];
    handlers.list_labels = () => labels;
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m1");
    fireEvent.keyDown(document, { key: "l" });
    await screen.findByText("Receipts");
    fireEvent.keyDown(screen.getByPlaceholderText("Search labels..."), { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Receipts")).not.toBeInTheDocument());

    labels = [label("L1", "Receipts"), label("L2", "Travel")];
    fireEvent.keyDown(document, { key: "l" });
    expect(screen.getByText("Receipts")).toBeInTheDocument();
    expect(await screen.findByText("Travel")).toBeInTheDocument();
  });

  it("keeps the thread's shortcuts off while the drawer is open and closes only the drawer on Escape", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    handlers.list_labels = () => [{ id: "L1", name: "Receipts", messageListVisibility: null, labelListVisibility: null, label_type: "user" }];
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m1");
    fireEvent.keyDown(document, { key: "l" });
    await screen.findByText("Receipts");

    fireEvent.keyDown(document, { key: "a" });
    expect(invoke).not.toHaveBeenCalledWith("modify_threads", expect.anything());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Receipts")).not.toBeInTheDocument());
    expect(screen.getByText("body m1")).toBeInTheDocument();
  });

  it("filters the labels by name, ignoring case, and says when none match", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    handlers.list_labels = () => ["Receipts", "Travel"].map((name, i) => ({ id: `L${i}`, name, messageListVisibility: null, labelListVisibility: null, label_type: "user" }));
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m1");
    fireEvent.keyDown(document, { key: "l" });
    const search = await screen.findByPlaceholderText("Search labels...");
    await screen.findByText("Travel");
    fireEvent.input(search, { target: { value: "REC" } });
    expect(screen.getByText("Receipts")).toBeInTheDocument();
    expect(screen.queryByText("Travel")).not.toBeInTheDocument();
    fireEvent.input(search, { target: { value: "zzz" } });
    expect(screen.getByText("No labels found")).toBeInTheDocument();
  });

  it("opens the drawer unfiltered after the thread it was searched in closes", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    handlers.list_labels = () => [{ id: "L1", name: "Receipts", messageListVisibility: null, labelListVisibility: null, label_type: "user" }];
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m1");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.input(await screen.findByPlaceholderText("Search labels..."), { target: { value: "zzz" } });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("body m1")).not.toBeInTheDocument());

    fireEvent.click(await screen.findByText("Mail for A"));
    await screen.findByText("body m1");
    fireEvent.keyDown(document, { key: "l" });
    expect((await screen.findByPlaceholderText("Search labels...") as HTMLInputElement).value).toBe("");
  });
});

describe("App quick reply feedback", () => {
  function openQuickReply() {
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "r" });
    return document.querySelector(".quick-reply-input") as HTMLTextAreaElement;
  }

  it("confirms a sent quick reply", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    handlers.reply_to_thread = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    const input = openQuickReply();
    fireEvent.input(input, { target: { value: "Thanks" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    expect(await screen.findByText("Reply sent")).toBeInTheDocument();
  });

  it("signs a quick reply and refreshes its card once sent", async () => {
    handlers.get_accounts = () => [{ ...account("a", "a@x.com"), signature: "Ana" }];
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Bo <bo@x.com>")] });
    handlers.reply_to_thread = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    const input = openQuickReply();
    fireEvent.input(input, { target: { value: "Thanks" } });
    invoke.mockClear();
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("reply_to_thread", expect.objectContaining({ body: "Thanks\n\n-- \nAna" })));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("fetch_threads_paginated", expect.objectContaining({ cardId: "card-a" })));
  });

  it("keeps text typed into another quick reply while the first one sends", async () => {
    threadsByCard["card-a"] = [thread("t-a", "Mail for A"), thread("t-2", "Second mail")];
    handlers.get_thread_details = ({ threadId }) => ({ id: threadId, messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    let releaseSend!: () => void;
    const slowSend = new Promise<void>(r => { releaseSend = r; });
    handlers.reply_to_thread = async () => { await slowSend; return null; };
    render(() => <App />);
    await screen.findByText("Second mail");
    const first = openQuickReply();
    fireEvent.input(first, { target: { value: "Thanks" } });
    fireEvent.keyDown(first, { key: "Enter", metaKey: true });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("reply_to_thread", expect.anything()));

    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "r" });
    const second = document.querySelector(".quick-reply-input") as HTMLTextAreaElement;
    fireEvent.input(second, { target: { value: "Half typed" } });
    releaseSend();
    await screen.findByText("Reply sent");

    expect((document.querySelector(".quick-reply-input") as HTMLTextAreaElement).value).toBe("Half typed");
  });

  it("says when there is no one else to react to", async () => {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Me <a@x.com>")] });
    handlers.send_reaction = () => null;
    render(() => <App />);
    await screen.findByText("Mail for A");
    openQuickReply();
    fireEvent.click(await screen.findByTitle("Add reaction"));
    fireEvent.click(document.querySelector<HTMLButtonElement>(".emoji-picker .emoji-btn")!);

    expect(await screen.findByText("No one else to react to")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("send_reaction", expect.anything());
  });
});

describe("App sign-in flows", () => {
  it("cancels a sign-in waiting on the browser without showing an error", async () => {
    handlers.get_accounts = () => [];
    let rejectFlow!: (e: unknown) => void;
    handlers.run_oauth_flow = () => new Promise((_, reject) => { rejectFlow = reject; });
    handlers.cancel_oauth_flow = () => { rejectFlow("OAuth callback error: OAuth flow cancelled"); return null; };
    render(() => <App />);
    fireEvent.click(await screen.findByText("Sign in with Google"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("run_oauth_flow", undefined));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("Sign in with Google")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("cancel_oauth_flow", undefined);
    expect(screen.queryByText(/cancelled/)).not.toBeInTheDocument();
    expect(screen.queryByText("Complete sign-in in your browser...")).not.toBeInTheDocument();
  });

  it("cancels a sign-in waiting on the browser on Escape", async () => {
    handlers.get_accounts = () => [];
    let rejectFlow!: (e: unknown) => void;
    handlers.run_oauth_flow = () => new Promise((_, reject) => { rejectFlow = reject; });
    handlers.cancel_oauth_flow = () => { rejectFlow("OAuth callback error: OAuth flow cancelled"); return null; };
    render(() => <App />);
    fireEvent.click(await screen.findByText("Sign in with Google"));
    await screen.findByText("Complete sign-in in your browser...");
    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByText("Sign in with Google")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("cancel_oauth_flow", undefined);
  });

  it("connects with credentials entered in Settings", async () => {
    handlers.get_accounts = () => [];
    handlers.get_stored_credentials = () => null;
    handlers.run_oauth_flow = () => account("a", "a@x.com");
    render(() => <App />);
    fireEvent.click(await screen.findByText("Settings"));
    fireEvent.input(screen.getByLabelText("Client ID"), { target: { value: "cid" } });
    fireEvent.input(screen.getByLabelText("Client Secret"), { target: { value: "csecret" } });
    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));

    expect(await screen.findByText("Start from scratch")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("configure_auth", { config: { client_id: "cid", client_secret: "csecret" } });
    expect(invoke).not.toHaveBeenCalledWith("get_stored_credentials", expect.anything());
  });

  it("says why saving credentials failed and runs no sign-in", async () => {
    handlers.get_accounts = () => [];
    handlers.get_stored_credentials = () => null;
    handlers.configure_auth = () => { throw "keychain locked"; };
    handlers.run_oauth_flow = () => account("a", "a@x.com");
    render(() => <App />);
    fireEvent.click(await screen.findByText("Settings"));
    fireEvent.input(screen.getByLabelText("Client ID"), { target: { value: "cid" } });
    fireEvent.input(screen.getByLabelText("Client Secret"), { target: { value: "csecret" } });
    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));

    expect(await screen.findByText("Failed to save credentials: keychain locked")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("run_oauth_flow", expect.anything());
  });

  it("sends the user to Settings when signing in without credentials", async () => {
    handlers.get_accounts = () => [];
    handlers.get_stored_credentials = () => null;
    render(() => <App />);
    fireEvent.click(await screen.findByText("Sign in with Google"));

    expect(await screen.findByText("Connect your Google account in Settings")).toBeInTheDocument();
    expect(document.querySelector(".settings-sidebar.open")).not.toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("run_oauth_flow", expect.anything());
  });

  it("says the keychain is locked when signing in, instead of sending the user to Settings", async () => {
    handlers.get_accounts = () => [];
    let reads = 0;
    handlers.get_stored_credentials = () => {
      if (reads++ === 0) return null;
      throw "Keychain unavailable (locked or access denied). Unlock the keychain and try again.";
    };
    render(() => <App />);
    const signIn = await screen.findByText("Sign in with Google");
    await waitFor(() => expect(reads).toBe(1));
    fireEvent.click(signIn);

    await waitFor(() => expect(screen.getAllByText(/Keychain unavailable/).length).toBeGreaterThan(0));
    expect(screen.queryByText("Connect your Google account in Settings")).not.toBeInTheDocument();
    expect(document.querySelector(".settings-sidebar.open")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("run_oauth_flow", expect.anything());
  });

  it("shows a failed sign-in and stops waiting", async () => {
    handlers.get_accounts = () => [];
    handlers.run_oauth_flow = () => { throw "OAuth callback error: Timed out waiting for sign-in in the browser. Try again."; };
    render(() => <App />);
    fireEvent.click(await screen.findByText("Sign in with Google"));

    expect(await screen.findByText(/Timed out waiting for sign-in in the browser/)).toBeInTheDocument();
    expect(screen.queryByText("Complete sign-in in your browser...")).not.toBeInTheDocument();
  });
});

describe("App batch reply closing", () => {
  async function openBatchReplyWithText() {
    handlers.get_thread_details = () => ({ id: "t-a", messages: [fullMessage("m1", "Ana <ana@x.com>")] });
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.click(await screen.findByTitle("Batch Reply"));
    const field = await screen.findByPlaceholderText(/^Reply to/);
    fireEvent.input(field, { target: { value: "A long answer" } });
    field.blur();
  }

  it("asks before discarding typed replies and keeps them when cancelled", async () => {
    await openBatchReplyWithText();
    fireEvent.keyDown(document, { key: "Escape" });
    await answerConfirm(false, /1 unsent reply/);
    await new Promise(r => setTimeout(r, 20));

    expect(screen.getByPlaceholderText(/^Reply to/)).toHaveValue("A long answer");
  });

  it("closes once the user agrees to discard", async () => {
    await openBatchReplyWithText();
    fireEvent.keyDown(document, { key: "Escape" });
    await answerConfirm(true);

    await waitFor(() => expect(screen.queryByPlaceholderText(/^Reply to/)).not.toBeInTheDocument());
  });

  it("asks before an account switch discards typed replies, and stays when cancelled", async () => {
    handlers.get_accounts = () => [account("a", "a@x.com"), account("b", "b@x.com")];
    await openBatchReplyWithText();
    fireEvent.click(screen.getByTitle("a@x.com"));
    fireEvent.click(await screen.findByText("b@x.com"));
    await answerConfirm(false, /1 unsent reply/);
    await new Promise(r => setTimeout(r, 20));

    expect(screen.getByPlaceholderText(/^Reply to/)).toHaveValue("A long answer");
    expect(invoke).not.toHaveBeenCalledWith("get_cards", { accountId: "b" });
  });

  it("does not act on the threads behind the panel", async () => {
    handlers.modify_threads = () => null;
    await openBatchReplyWithText();
    for (const key of ["d", "a", "s", "u", "!", "j"]) fireEvent.keyDown(document, { key });
    await new Promise(r => setTimeout(r, 20));

    expect(invoke).not.toHaveBeenCalledWith("modify_threads", expect.anything());
    expect(screen.getByPlaceholderText(/^Reply to/)).toHaveValue("A long answer");
  });

  it("asks before an account switch throws away a typed quick reply", async () => {
    handlers.get_accounts = () => [account("a", "a@x.com"), account("b", "b@x.com")];
    render(() => <App />);
    await screen.findByText("Mail for A");
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "r" });
    const input = await screen.findByPlaceholderText("Write a reply...");
    fireEvent.input(input, { target: { value: "Quick answer" } });
    fireEvent.click(screen.getByTitle("a@x.com"));
    fireEvent.click(await screen.findByText("b@x.com"));
    await answerConfirm(false, /quick reply/);
    await new Promise(r => setTimeout(r, 20));

    expect(screen.getByPlaceholderText("Write a reply...")).toHaveValue("Quick answer");
    expect(invoke).not.toHaveBeenCalledWith("get_cards", { accountId: "b" });

    fireEvent.click(screen.getByTitle("a@x.com"));
    fireEvent.click(await screen.findByText("b@x.com"));
    await answerConfirm(true);
    expect(await screen.findByText("Mail for B")).toBeInTheDocument();
  });
});
