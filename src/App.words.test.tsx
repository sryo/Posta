import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure, render, screen } from "@solidjs/testing-library";

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
import type { Account, Card, Thread, ThreadGroup } from "./api/tauri";
import { ICLOUD_RESTORE_DELAYS_MS } from "./app/icloudRestore";
import { formatClock } from "./app/dateFormat";

ICLOUD_RESTORE_DELAYS_MS.first = 0;
ICLOUD_RESTORE_DELAYS_MS.retry = 0;

const DAY = 86_400_000;
const account = (id: string, email: string): Account => ({ id, email, picture: null, signature: null });
const card = (id: string, name: string, query = "is:inbox"): Card => ({
  id, account_id: "a", name, query, position: 0, collapsed: false, color: null, group_by: "date", card_type: "email",
});
const thread = (id: string, subject: string, over: Partial<Thread> = {}): Thread => ({
  gmail_thread_id: id, account_id: "a", subject, snippet: "", last_message_date: Date.now(),
  unread_count: 0, labels: ["INBOX"], participants: [], has_attachment: false, attachments: [], calendar_event: null, ...over,
});
// Local midnight `days` ago, plus `hour`
const daysAgoAt = (days: number, hour: number) => new Date(new Date().setHours(0, 0, 0, 0) - days * DAY).setHours(hour, 15);

let cards: Card[] = [];
let groupsByCard: Record<string, ThreadGroup[]> = {};

beforeEach(() => {
  localStorage.clear();
  invoke.mockClear();
  for (const k of Object.keys(handlers)) delete handlers[k];
  cards = [card("card-a", "Alpha")];
  groupsByCard = {};
  Object.assign(handlers, {
    init_app: () => null,
    get_stored_credentials: () => ({ client_id: "id", client_secret: "secret" }),
    configure_auth: () => null,
    pull_from_icloud: () => false,
    get_accounts: () => [account("a", "a@x.com")],
    get_cards: () => cards,
    get_cached_card_threads: () => null,
    save_cached_card_threads: () => null,
    fetch_threads_paginated: ({ cardId }) => ({ groups: groupsByCard[cardId as string] ?? [], next_page_token: null, has_more: false }),
    sync_threads_incremental: () => ({ modified_threads: [], deleted_thread_ids: [], is_full_sync: false }),
    fetch_contacts: () => [],
    take_pending_mailtos: () => [],
    has_gemini_api_key: () => false,
  } satisfies Record<string, Handler>);
});

afterEach(() => {
  vi.useRealTimers();
});
Element.prototype.scrollIntoView = () => {};

const rowOf = (subject: string) => screen.getByText(subject).closest(".thread") as HTMLElement;
const headings = () => [...document.querySelectorAll(".date-header")].map(h => h.textContent);

describe("Headings that name the days", () => {
  it("names a group's only day and gives its rows the clock", async () => {
    const early = daysAgoAt(3, 9);
    const late = daysAgoAt(3, 17);
    groupsByCard["card-a"] = [{ label: "This week", threads: [thread("t-1", "Late one", { last_message_date: late }), thread("t-2", "Early one", { last_message_date: early })] }];
    render(() => <App />);
    await screen.findByText("Late one");
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(late));
    expect(headings()).toEqual([weekday]);
    expect(rowOf("Late one").querySelector(".thread-time")).toHaveTextContent(formatClock(new Date(late)));
    expect(rowOf("Early one").querySelector(".thread-time")).toHaveTextContent(formatClock(new Date(early)));
  });

  it("names the month of older mail and keeps dates on its rows", async () => {
    const a = new Date(2024, 2, 20, 10, 15).getTime();
    const b = new Date(2024, 2, 3, 10, 15).getTime();
    groupsByCard["card-a"] = [{ label: "Older", threads: [thread("t-1", "Newer old", { last_message_date: a }), thread("t-2", "Older old", { last_message_date: b })] }];
    render(() => <App />);
    await screen.findByText("Newer old");
    expect(headings()).toEqual(["In March 2024"]);
    expect(rowOf("Newer old").querySelector(".thread-time")).not.toHaveTextContent(formatClock(new Date(a)));
  });
});

describe("Unanswered since Friday", () => {
  const ana = "Ana Pérez <ana@acme.co>";

  it("says under a read thread a person wrote last how long it has gone unanswered, and tells screen readers", async () => {
    groupsByCard["card-a"] = [{ label: "Last 30 days", threads: [
      thread("t-1", "Venue for the offsite", { last_message_date: daysAgoAt(10, 16), participants: [ana], last_sender: ana }),
      thread("t-2", "Answered already", { last_message_date: daysAgoAt(10, 17), participants: [ana, "a@x.com"], last_sender: "a@x.com" }),
    ] }];
    render(() => <App />);
    await screen.findByText("Venue for the offsite");
    const row = rowOf("Venue for the offsite");
    expect(row.querySelector(".thread-aside")).toHaveTextContent("Unanswered for a week");
    expect(row.getAttribute("aria-label")).toMatch(/\. Unanswered for a week$/);
    expect(rowOf("Answered already").querySelector(".thread-aside")).toBeNull();
  });
});
