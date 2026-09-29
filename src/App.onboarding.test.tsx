import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";

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
let nextCardId = 0;

beforeEach(() => {
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
    get_cards: ({ accountId }) => cardsByAccount[accountId as string] ?? [],
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
  await screen.findByText("Mail for A");
  fireEvent.click(screen.getByTitle("a@x.com"));
  fireEvent.click(within(document.querySelector(".account-chooser-container") as HTMLElement).getByText("Settings"));
  await waitFor(() => expect(settingsSidebar()).toHaveClass("open"));
  return settingsSidebar();
}

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
