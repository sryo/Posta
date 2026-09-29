import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";

vi.setConfig({ testTimeout: 20000 });
configure({ asyncUtilTimeout: 4000 });

type Handler = (args: Record<string, unknown>) => unknown;
const handlers: Record<string, Handler> = {};
// Accounts signed in during the test, which the backend would list from then on
const signedInDuringTest = new Set<string>();
const invoke = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
  const handler = handlers[cmd];
  if (!handler) throw new Error(`unmocked command ${cmd}`);
  const result = await handler(args);
  if (cmd === "run_oauth_flow") signedInDuringTest.add((result as { id: string }).id);
  return result;
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setBadgeCount: async () => {}, startDragging: async () => {} }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
const openUrl = vi.fn(async (_url: string) => {});
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrl(url) }));
vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: async () => ({ popup: async () => {} }) },
  MenuItem: { new: async (opts: unknown) => opts },
  PredefinedMenuItem: { new: async () => ({}) },
}));

import App from "./App";
import type { Account, Card, Thread } from "./api/tauri";
import { ICLOUD_RESTORE_DELAYS_MS } from "./app/icloudRestore";

ICLOUD_RESTORE_DELAYS_MS.first = 0;
ICLOUD_RESTORE_DELAYS_MS.retry = 0;

const account = (id: string, email: string): Account => ({ id, email, picture: null, signature: null });
const card = (id: string, accountId: string, name: string, query = "is:inbox"): Card => ({
  id, account_id: accountId, name, query, position: 0, collapsed: false,
  color: null, group_by: "date", card_type: query.startsWith("calendar:") ? "calendar" : "email",
});
const thread = (id: string, subject: string): Thread => ({
  gmail_thread_id: id, account_id: "", subject, snippet: "", last_message_date: 0,
  unread_count: 0, labels: [], participants: [], has_attachment: false, attachments: [], calendar_event: null,
});

const cardsByAccount: Record<string, Card[]> = {};
const threadsByCard: Record<string, Thread[]> = {};
// The account chooser's button, titled with the default account's email
// (cards' account badges carry the emails too)
function avatar(email: string): HTMLElement {
  const button = document.querySelector<HTMLElement>(`.toolbar-avatar[title="${email}"]`);
  if (!button) throw new Error(`No account button for ${email}`);
  return button;
}
let nextCardId = 0;

beforeEach(() => {
  signedInDuringTest.clear();
  localStorage.clear();
  invoke.mockClear();
  openUrl.mockClear();
  nextCardId = 0;
  for (const k of Object.keys(handlers)) delete handlers[k];
  for (const k of Object.keys(cardsByAccount)) delete cardsByAccount[k];
  for (const k of Object.keys(threadsByCard)) delete threadsByCard[k];
  Object.assign(handlers, {
    init_app: () => null,
    get_stored_credentials: () => ({ client_id: `${"1234"}-abc.apps.googleusercontent.com`, client_secret: "GOCSPX-secret" }),
    configure_auth: () => null,
    pull_from_icloud: () => false,
    get_accounts: () => [account("a", "a@x.com")],
    // The board: the cards of the accounts signed in
    get_cards: () => [...new Set([...(handlers.get_accounts({}) as Account[]).map(a => a.id), ...signedInDuringTest])]
      .flatMap(id => cardsByAccount[id] ?? []),
    create_card: ({ accountId, name, query }) => {
      const created = { ...card(`new-${nextCardId++}`, accountId as string, name as string, query as string), position: nextCardId };
      (cardsByAccount[accountId as string] ??= []).push(created);
      return created;
    },
    delete_card: ({ id }) => {
      for (const list of Object.values(cardsByAccount)) {
        const i = list.findIndex(c => c.id === id);
        if (i >= 0) list.splice(i, 1);
      }
      return null;
    },
    get_cached_card_threads: () => null,
    save_cached_card_threads: () => null,
    get_cached_card_events: () => null,
    save_cached_card_events: () => null,
    fetch_calendar_events: () => [],
    fetch_threads_paginated: ({ cardId }) => ({
      groups: [{ label: "Today", threads: threadsByCard[cardId as string] ?? [] }],
      next_page_token: null,
      has_more: false,
    }),
    sync_threads_incremental: () => ({ modified_threads: [], deleted_thread_ids: [], is_full_sync: false }),
    fetch_contacts: () => [],
    take_pending_mailtos: () => [],
    has_gemini_api_key: () => false,
    get_icloud_sync_status: () => ({ available: true, last_synced_at: null, last_error: null }),
  } satisfies Record<string, Handler>);
  cardsByAccount.a = [card("card-a", "a", "Alpha")];
  threadsByCard["card-a"] = [thread("t-a", "Mail for A")];
});

afterEach(() => {
  vi.useRealTimers();
});
Element.prototype.scrollIntoView = () => {};

const settingsSidebar = () => document.querySelector(".settings-sidebar") as HTMLElement;
async function openSettingsFromChooser() {
  fireEvent.click(await waitFor(() => avatar("a@x.com")));
  fireEvent.click(within(document.querySelector(".account-chooser-container") as HTMLElement).getByText("Settings"));
  await waitFor(() => expect(settingsSidebar()).toHaveClass("open"));
  return settingsSidebar();
}

describe("Sign-in wait", () => {
  it("asks the user to finish in the browser, can reopen the page, then says it is setting up cards", async () => {
    handlers.get_accounts = () => [];
    let resolveFlow!: (a: Account) => void;
    handlers.run_oauth_flow = () => new Promise(resolve => { resolveFlow = resolve; });
    handlers.reopen_oauth_page = () => null;
    let resolvePull!: (v: boolean) => void;
    handlers.pull_from_icloud = () => new Promise(resolve => { resolvePull = resolve; });
    render(() => <App />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("pull_from_icloud", undefined));
    resolvePull(false);

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));
    expect(await screen.findByText("Finish signing in with Google in your browser. Posta will pick up automatically.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open sign-in page again" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("reopen_oauth_page", undefined));
    await waitFor(() => expect(resolveFlow).toBeTypeOf("function"));

    resolveFlow(account("a", "a@x.com"));
    expect(await screen.findByText("Setting up your cards…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open sign-in page again" })).not.toBeInTheDocument();
    await waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "pull_from_icloud")).toHaveLength(2));
    resolvePull(true);
    await screen.findByText("Mail for A");
    expect(screen.queryByText("Setting up your cards…")).not.toBeInTheDocument();
  });
});

const VALID_ID = `${"1234567890"}-abcdefghijklmnop.apps.googleusercontent.com`;
const VALID_SECRET = "GOCSPX-AbCdEfGhIjKlMnOpQrStUvWxYz12";

describe("First-run setup", () => {
  beforeEach(() => {
    handlers.get_accounts = () => [];
    handlers.get_stored_credentials = () => null;
  });

  it("sets Posta up in place: credentials first, then Google sign-in", async () => {
    handlers.run_oauth_flow = () => account("a", "a@x.com");
    render(() => <App />);

    expect(await screen.findByRole("heading", { name: "Set up Posta" })).toBeInTheDocument();
    expect(screen.getByText(/through your own Google Cloud project/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Add Google credentials/ })).toBeInTheDocument();
    const signIn = screen.getByRole("button", { name: "Sign in with Google" });
    expect(signIn).toBeDisabled();

    fireEvent.input(screen.getByLabelText("OAuth client ID"), { target: { value: VALID_ID } });
    fireEvent.input(screen.getByLabelText("OAuth client secret"), { target: { value: VALID_SECRET } });
    expect(signIn).toBeEnabled();
    fireEvent.click(signIn);

    await screen.findByText("Mail for A");
    expect(invoke).toHaveBeenCalledWith("configure_auth", { config: { client_id: VALID_ID, client_secret: VALID_SECRET } });
    expect(document.querySelector(".settings-sidebar.open")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says why saving the credentials failed and runs no sign-in", async () => {
    handlers.configure_auth = () => { throw "keychain locked"; };
    handlers.run_oauth_flow = () => account("a", "a@x.com");
    render(() => <App />);
    fireEvent.input(await screen.findByLabelText("OAuth client ID"), { target: { value: VALID_ID } });
    fireEvent.input(screen.getByLabelText("OAuth client secret"), { target: { value: VALID_SECRET } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));

    expect(await screen.findByText("Couldn't save the credentials.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("run_oauth_flow", expect.anything());
  });

  it("mentions the local sign-in port once a sign-in has failed", async () => {
    handlers.run_oauth_flow = () => { throw "OAuth callback error: Address already in use"; };
    render(() => <App />);
    fireEvent.input(await screen.findByLabelText("OAuth client ID"), { target: { value: VALID_ID } });
    fireEvent.input(screen.getByLabelText("OAuth client secret"), { target: { value: VALID_SECRET } });
    expect(screen.queryByText(/port 8420/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));

    await screen.findByText(/Address already in use/);
    fireEvent.click(await screen.findByRole("button", { name: "Change credentials" }));
    expect(await screen.findByText(/port 8420/)).toBeInTheDocument();
  });

  it("offers a single sign-in once a client is stored, with a way to change it", async () => {
    handlers.get_stored_credentials = () => ({ client_id: VALID_ID, client_secret: VALID_SECRET });
    render(() => <App />);
    const signIn = await screen.findByRole("button", { name: "Sign in with Google" });
    expect(signIn).toBeEnabled();
    expect(screen.queryByLabelText("OAuth client ID")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change credentials" }));
    expect(await screen.findByRole("heading", { name: "Set up Posta" })).toBeInTheDocument();
    expect(screen.getByLabelText("OAuth client ID")).toBeInTheDocument();
  });
});

const createdCards = () => invoke.mock.calls.filter(([cmd]) => cmd === "create_card").map(([, args]) => args as Record<string, unknown>);

describe("Layout after sign-in", () => {
  it("restores a synced layout without asking, and can swap it for a preset and back", async () => {
    handlers.get_accounts = () => [];
    handlers.run_oauth_flow = () => account("a", "a@x.com");
    handlers.pull_from_icloud = () => true;
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));

    await screen.findByText("Mail for A");
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Restored 1 card from iCloud");
    expect(screen.queryByText("Welcome Back")).not.toBeInTheDocument();

    fireEvent.click(within(toast).getByRole("button", { name: "Choose a different layout" }));
    const picker = await screen.findByRole("dialog", { name: "Pick a starting layout" });
    fireEvent.click(within(picker).getByRole("button", { name: /^Classic/ }));

    expect(await screen.findByRole("region", { name: "Inbox email card" })).toBeInTheDocument();
    // Replacing is undoable, so it isn't confirmed
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("delete_card", { id: "card-a" });
    expect(screen.queryByRole("region", { name: "Alpha email card" })).not.toBeInTheDocument();

    const sidebar = await openSettingsFromChooser();
    const restore = within(sidebar).getByRole("button", { name: /Restore previous layout/ });
    expect(restore).toHaveTextContent("1 card");
    fireEvent.click(restore);

    expect(await screen.findByRole("region", { name: "Alpha email card" })).toBeInTheDocument();
    expect(createdCards().slice(-1)[0]).toMatchObject({ accountId: "a", name: "Alpha", query: "is:inbox" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Inbox email card" })).not.toBeInTheDocument());
  });

  it("offers a different layout from Settings too", async () => {
    render(() => <App />);
    const sidebar = await openSettingsFromChooser();
    fireEvent.click(within(sidebar).getByRole("button", { name: "Choose a different layout" }));
    expect(await screen.findByRole("dialog", { name: "Pick a starting layout" })).toBeInTheDocument();
  });

  it("lets the preset picker be dismissed with Escape", async () => {
    handlers.get_accounts = () => [];
    handlers.run_oauth_flow = () => account("n", "n@x.com");
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));
    await screen.findByRole("dialog", { name: "Pick a starting layout" });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pick a starting layout" })).not.toBeInTheDocument());
    expect(createdCards()).toHaveLength(0);
  });

  it("replaces the whole board with a preset, and puts each card back in its account on restore", async () => {
    handlers.get_accounts = () => [account("a", "a@x.com"), account("b", "b@x.com")];
    cardsByAccount.b = [{ ...card("card-b", "b", "Beta"), position: 1 }];
    render(() => <App />);
    await screen.findByRole("region", { name: "Beta email card" });
    let sidebar = await openSettingsFromChooser();
    fireEvent.click(within(sidebar).getByRole("button", { name: "Choose a different layout" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Pick a starting layout" })).getByRole("button", { name: /^Classic/ }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pick a starting layout" })).not.toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "Beta email card" })).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("delete_card", { id: "card-b" });
    expect(createdCards().every(c => c.accountId === "a")).toBe(true);

    sidebar = await openSettingsFromChooser();
    fireEvent.click(within(sidebar).getByRole("button", { name: /Restore previous layout/ }));
    expect(await screen.findByRole("region", { name: "Beta email card" })).toBeInTheDocument();
    expect(createdCards().slice(-2)).toEqual([
      expect.objectContaining({ accountId: "a", name: "Alpha" }),
      expect.objectContaining({ accountId: "b", name: "Beta" }),
    ]);
  });
});

describe("Blank board", () => {
  it("guides an account without cards and adds a starter card in one click", async () => {
    cardsByAccount.a = [];
    render(() => <App />);
    expect(await screen.findByRole("heading", { name: "Cards are saved searches" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(await screen.findByRole("region", { name: "Unread email card" })).toBeInTheDocument();
    expect(createdCards()).toEqual([expect.objectContaining({ accountId: "a", name: "Unread", query: "is:unread" })]);
    expect(screen.queryByRole("heading", { name: "Cards are saved searches" })).not.toBeInTheDocument();
  });

  it("opens the presets and the search operators from the blank board", async () => {
    cardsByAccount.a = [];
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Search operators" }));
    expect(await screen.findByText("Query Operators")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Browse presets" }));
    expect(await screen.findByRole("dialog", { name: "Pick a starting layout" })).toBeInTheDocument();
    // The picker stands in for the guidance rather than stacking on it
    expect(screen.queryByRole("heading", { name: "Cards are saved searches" })).not.toBeInTheDocument();
  });
});

describe("Smart replies key", () => {
  it("opens Settings at Smart replies from a thread whose suggestions need a new key", async () => {
    handlers.has_gemini_api_key = () => true;
    handlers.suggest_replies = () => { throw "Gemini API error 403 Forbidden: {}"; };
    handlers.modify_threads = () => null;
    handlers.get_thread_details = () => ({
      id: "t-a",
      messages: [{
        id: "m1", threadId: "t-a", labelIds: ["INBOX"], snippet: "body m1", internalDate: "0",
        payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Ana <ana@x.com>" }, { name: "Subject", value: "Hi" }], body: { size: 0 } },
      }],
    });
    render(() => <App />);
    fireEvent.click(await screen.findByText("Mail for A"));
    fireEvent.click(await screen.findByRole("button", { name: "Open Settings" }));

    await waitFor(() => expect(settingsSidebar()).toHaveClass("open"));
    expect(within(settingsSidebar()).getByRole("button", { name: /Smart replies/ })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("Settings Google connection", () => {
  it("shows the client in use and re-authorizes the current account after new credentials", async () => {
    handlers.get_stored_credentials = () => ({ client_id: VALID_ID, client_secret: VALID_SECRET });
    handlers.run_oauth_flow = () => account("a", "a@x.com");
    handlers.pull_from_icloud = () => true;
    const sidebar = await (async () => { render(() => <App />); return openSettingsFromChooser(); })();

    expect(within(sidebar).getByText("Google connection")).toBeInTheDocument();
    await waitFor(() => expect(sidebar).toHaveTextContent("Using client 1234…apps.googleusercontent.com"));
    expect(sidebar.querySelector(".settings-hint svg[data-icon=check]")).not.toBeNull();
    expect(within(sidebar).queryByLabelText("OAuth client ID")).not.toBeInTheDocument();
    const change = within(sidebar).getByRole("button", { name: "Change credentials" });
    expect(change).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(change);
    expect(change).toHaveAttribute("aria-expanded", "true");

    const save = within(sidebar).getByRole("button", { name: /^Save and sign in/ });
    expect(save).toBeDisabled();
    fireEvent.input(within(sidebar).getByLabelText("OAuth client ID"), { target: { value: VALID_ID.replace("1234", "9999") } });
    fireEvent.input(within(sidebar).getByLabelText("OAuth client secret"), { target: { value: VALID_SECRET } });
    const calls = (cmd: string) => invoke.mock.calls.filter(([c]) => c === cmd).length;
    const pullsBefore = calls("pull_from_icloud");
    const cardLoadsBefore = calls("get_cards");
    fireEvent.click(save);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("run_oauth_flow", undefined));
    await waitFor(() => expect(calls("get_cards")).toBeGreaterThan(cardLoadsBefore));
    await screen.findByText("Mail for A");
    await new Promise(r => setTimeout(r, 30));
    expect(calls("pull_from_icloud")).toBe(pullsBefore);
    expect(screen.queryByText(/Restored .* from iCloud/)).not.toBeInTheDocument();
    // Only the account is signed in again: no layout prompt or preset picker
    expect(screen.queryByText("Welcome Back")).not.toBeInTheDocument();
    expect(document.querySelector(".preset-overlay")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("delete_card", expect.anything());
  });
});

describe("Settings panel focus", () => {
  it("keeps the closed panel out of the tab order and moves focus to Close on open", async () => {
    render(() => <App />);
    await screen.findByText("Mail for A");
    expect(settingsSidebar()).toHaveAttribute("inert");
    expect(settingsSidebar()).toHaveAttribute("aria-hidden", "true");

    const sidebar = await openSettingsFromChooser();
    expect(sidebar).not.toHaveAttribute("inert");
    expect(sidebar).not.toHaveAttribute("aria-hidden");
    await waitFor(() => expect(document.activeElement).toBe(within(sidebar).getByTitle("Close (Esc)")));
  });
});
