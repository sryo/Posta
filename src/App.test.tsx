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
vi.mock("@tauri-apps/api/menu", () => ({ Menu: {}, MenuItem: {}, PredefinedMenuItem: {} }));

import App from "./App";

const account = (id: string, email: string) => ({ id, email, picture: null, signature: null });
const card = (id: string, accountId: string, name: string) => ({
  id, account_id: accountId, name, query: "is:inbox", position: 0, collapsed: false,
  color: null, group_by: "date", card_type: "email",
});
const thread = (id: string, subject: string) => ({
  gmail_thread_id: id, account_id: "", subject, snippet: "", last_message_date: 0,
  unread_count: 0, labels: [], participants: [], has_attachment: false, attachments: [], calendar_event: null,
});

const cardsByAccount: Record<string, ReturnType<typeof card>[]> = {};
const threadsByCard: Record<string, ReturnType<typeof thread>[]> = {};

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
