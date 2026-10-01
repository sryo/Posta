import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure, render, screen, within } from "@solidjs/testing-library";

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
import type { Account, Card, GoogleCalendarEvent } from "./api/tauri";
import { ICLOUD_RESTORE_DELAYS_MS } from "./app/icloudRestore";
import { setNoticesEnabled } from "./app/notices";

ICLOUD_RESTORE_DELAYS_MS.first = 0;
ICLOUD_RESTORE_DELAYS_MS.retry = 0;

const account = (id: string, email: string): Account => ({ id, email, picture: null, signature: null });
const calendarCard = (id: string, name: string, query: string, position = 0): Card => ({
  id, account_id: "a", name, query, position, collapsed: false, color: null, group_by: "date", card_type: "calendar",
});

// A Thursday, 1 October 2026; `day` 2 is the Friday after
const at = (h: number, m = 0, day = 1) => new Date(2026, 9, day, h, m).getTime();

const event = (id: string, start: number, end: number, extra: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent => ({
  id, calendar_id: "primary", calendar_name: "Main", title: id, description: null, location: null,
  start_time: start, end_time: end, all_day: false, status: "confirmed", organizer: "a@x.com", attendees: [],
  html_link: null, hangout_link: null, response_status: "accepted", can_edit: true, ...extra,
});

let cards: Card[] = [];
let eventsByQuery: Record<string, GoogleCalendarEvent[]> = {};

beforeEach(() => {
  localStorage.clear();
  invoke.mockClear();
  for (const k of Object.keys(handlers)) delete handlers[k];
  cards = [calendarCard("today", "Today", "calendar:today")];
  eventsByQuery = {};
  Object.assign(handlers, {
    init_app: () => null,
    get_stored_credentials: () => ({ client_id: "id", client_secret: "secret" }),
    configure_auth: () => null,
    pull_from_icloud: () => false,
    get_accounts: () => [account("a", "a@x.com")],
    get_cards: () => cards,
    get_cached_card_threads: () => null,
    save_cached_card_threads: () => null,
    get_cached_card_events: () => null,
    save_cached_card_events: () => null,
    fetch_calendar_events: ({ query }) => structuredClone(eventsByQuery[query as string] ?? []),
    fetch_threads_paginated: () => ({ groups: [], next_page_token: null, has_more: false }),
    sync_threads_incremental: () => ({ modified_threads: [], deleted_thread_ids: [], is_full_sync: false }),
    fetch_contacts: () => [],
    take_pending_mailtos: () => [],
    has_gemini_api_key: () => false,
  } satisfies Record<string, Handler>);
});

afterEach(() => {
  vi.useRealTimers();
  setNoticesEnabled(true);
});
Element.prototype.scrollIntoView = () => {};

const card = (name: string) => screen.getByRole("region", { name: `${name} calendar card` });

describe("today's notes", () => {
  const thursday = () => [
    event("Standup", at(9, 30), at(10, 30)),
    event("Design crit", at(11), at(12)),
    event("1:1 with Sam", at(15, 30), at(16, 30)),
    event("Roadmap sync", at(16, 30), at(17, 30)),
  ];

  it("names the first one of the morning above its row", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: at(7, 45) });
    eventsByQuery["calendar:today"] = thursday();
    render(() => <App />);

    const note = (await screen.findByText("First one at 9:30 AM")).closest(".calendar-day-note") as HTMLElement;
    expect(note).toHaveAttribute("role", "note");
    expect(note.nextElementSibling).toHaveTextContent("Standup");
  });

  it("closes the day in the evening with when tomorrow starts, from the tomorrow card", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: at(17, 40) });
    cards.push(calendarCard("tomorrow", "Tomorrow", "calendar:tomorrow", 1));
    eventsByQuery["calendar:today"] = thursday();
    eventsByQuery["calendar:tomorrow"] = [event("Breakfast", at(8, 30, 2), at(9, 30, 2))];
    render(() => <App />);

    await screen.findByText("Breakfast");
    const today = card("Today");
    expect(await within(today).findByText("That's it for today. Tomorrow starts at 8:30 AM.")).toBeInTheDocument();
    expect(within(today).getByText("That's it for today. Tomorrow starts at 8:30 AM.").previousElementSibling).toHaveTextContent("Roadmap sync");
  });

  it("notes nothing while the user has turned noticing off", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: at(7, 45) });
    setNoticesEnabled(false);
    eventsByQuery["calendar:today"] = thursday();
    render(() => <App />);

    await screen.findByText("Standup");
    expect(document.querySelector(".calendar-day-note")).toBeNull();
  });
});
