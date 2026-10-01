import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";

// Every test renders the whole app; on a loaded machine the defaults fail
// tests that are only slow
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
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));
vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: async () => ({ popup: async () => {} }) },
  MenuItem: { new: async (opts: unknown) => opts },
  PredefinedMenuItem: { new: async () => ({}) },
}));

import App from "./App";
import { setInputMode } from "./app/inputMode";
import type { Account, Card, Thread } from "./api/tauri";
import { ICLOUD_RESTORE_DELAYS_MS } from "./app/icloudRestore";

ICLOUD_RESTORE_DELAYS_MS.first = 0;
ICLOUD_RESTORE_DELAYS_MS.retry = 0;

const account = (id: string, email: string): Account => ({ id, email, picture: null, signature: null });
const card = (id: string, name: string, query = "in:inbox", extra: Partial<Card> = {}): Card => ({
  id, account_id: "a", name, query, position: 0, collapsed: false,
  color: null, group_by: "date", card_type: query.startsWith("calendar:") ? "calendar" : "email", ...extra,
});
const thread = (id: string, subject: string, extra: Partial<Thread> = {}): Thread => ({
  gmail_thread_id: id, account_id: "a", subject, snippet: "", last_message_date: 0,
  unread_count: 0, labels: ["INBOX"], participants: ["Ana <ana@x.com>"], has_attachment: false, attachments: [], calendar_event: null,
  ...extra,
});

let boardCards: Card[] = [];
const threadsByCard: Record<string, Thread[]> = {};

beforeEach(() => {
  localStorage.clear();
  invoke.mockClear();
  setInputMode("pointer");
  for (const k of Object.keys(handlers)) delete handlers[k];
  for (const k of Object.keys(threadsByCard)) delete threadsByCard[k];
  Object.assign(handlers, {
    init_app: () => null,
    get_stored_credentials: () => ({ client_id: "id", client_secret: "secret" }),
    configure_auth: () => null,
    pull_from_icloud: () => false,
    get_accounts: () => [account("a", "a@x.com")],
    get_cards: () => boardCards,
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
    modify_threads: () => null,
  } satisfies Record<string, Handler>);
  boardCards = [card("inbox", "Inbox"), { ...card("receipts", "Receipts", "label:receipts"), position: 1 }];
  threadsByCard.inbox = [thread("t-1", "First"), thread("t-2", "Second")];
  threadsByCard.receipts = [thread("r-1", "Receipt one"), thread("r-2", "Receipt two")];
});

afterEach(() => {
  vi.useRealTimers();
});
Element.prototype.scrollIntoView = () => {};

const row = (subject: string) => screen.getByText(subject).closest<HTMLElement>(".thread")!;
const cardRegion = (name: string) => screen.getByRole("region", { name: `${name} email card` });
const press = (key: string) => fireEvent.keyDown(document, { key });

describe("Focus that knows the edge", () => {
  it("keeps the focus on the last row and says where to go next", async () => {
    render(() => <App />);
    await screen.findByText("Receipt two");
    press("l");
    press("j");
    press("j");

    expect(row("Second")).toHaveClass("focused");
    expect(row("Receipt one")).not.toHaveClass("focused");
    const hint = within(cardRegion("Inbox")).getByRole("status");
    expect(hint).toHaveTextContent("Last of 2 in Inbox · l Receipts");
  });

  it("names the top of the card going up from its first row", async () => {
    render(() => <App />);
    await screen.findByText("Receipt two");
    press("l");
    press("l");
    press("k");

    expect(row("Receipt one")).toHaveClass("focused");
    expect(within(cardRegion("Receipts")).getByRole("status")).toHaveTextContent("First in Receipts");
  });

  it("names the first card going left from it", async () => {
    render(() => <App />);
    await screen.findByText("Receipt two");
    press("l");
    press("h");

    expect(row("First")).toHaveClass("focused");
    expect(within(cardRegion("Inbox")).getByRole("status")).toHaveTextContent("Inbox is the first card");
  });

  it("lets the line go on the next move", async () => {
    render(() => <App />);
    await screen.findByText("Receipt two");
    press("l");
    press("j");
    press("j");
    press("k");

    expect(row("First")).toHaveClass("focused");
    expect(within(cardRegion("Inbox")).queryByRole("status")).toBeNull();
  });

  it("lets the line go by itself after a while", async () => {
    render(() => <App />);
    await screen.findByText("Receipt two");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    press("l");
    press("j");
    press("j");
    expect(within(cardRegion("Inbox")).getByRole("status")).toBeInTheDocument();
    vi.advanceTimersByTime(2600);
    expect(within(cardRegion("Inbox")).queryByRole("status")).toBeNull();
  });
});

describe("Focus that remembers its row", () => {
  it("comes back to the row each card was left on", async () => {
    render(() => <App />);
    await screen.findByText("Receipt two");
    press("l");
    press("j");
    expect(row("Second")).toHaveClass("focused");
    press("l");
    expect(row("Receipt one")).toHaveClass("focused");
    press("j");
    press("h");
    expect(row("Second")).toHaveClass("focused");
    press("l");
    expect(row("Receipt two")).toHaveClass("focused");
  });
});

describe("Focus ring", () => {
  it("draws one ring for the board in the colour of the focused row's card, only from the keyboard", async () => {
    boardCards = [card("inbox", "Inbox", "in:inbox", { color: "green" })];
    render(() => <App />);
    await screen.findByText("Second");
    expect(document.querySelector(".focus-ring")).toBeNull();

    press("l");
    setInputMode("keyboard");
    await waitFor(() => expect(document.querySelectorAll(".focus-ring")).toHaveLength(1));
    expect(document.querySelector(".focus-ring")).toHaveAttribute("data-hue", "green");

    setInputMode("pointer");
    await waitFor(() => expect(document.querySelector(".focus-ring")).toBeNull());
  });
});
