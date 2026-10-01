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

type Attendee = GoogleCalendarEvent["attendees"][number];
const person = (email: string, response_status: string | null, extra: Partial<Attendee> = {}): Attendee =>
  ({ email, display_name: null, response_status, is_self: false, is_organizer: false, ...extra });
const me = (extra: Partial<Attendee> = {}) => person("a@x.com", "accepted", { is_self: true, ...extra });

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

describe("everyone else declined", () => {
  const ROOM = person("c_18@resource.calendar.google.com", "accepted", { display_name: "Sala Norte" });
  const review = (attendees: Attendee[], extra: Partial<GoogleCalendarEvent> = {}) =>
    event("Pricing page review", at(15), at(16), { location: "Sala Norte", attendees, ...extra });
  const declined = () => [person("jules@x.com", "declined"), person("marta@x.com", "declined"), person("priya@x.com", "declined")];
  const row = (title: string) => screen.getByText(title).closest(".calendar-event-item") as HTMLElement;

  it("counts the organizer's guests who all declined, in place of the place", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: at(9) });
    eventsByQuery["calendar:today"] = [review([me({ is_organizer: true }), ROOM, ...declined()])];
    render(() => <App />);

    expect(await screen.findByText("All 3 guests declined")).toBeInTheDocument();
    expect(within(row("Pricing page review")).queryByText("Sala Norte")).toBeNull();
  });

  it("cancels the event for the organizer once asked, telling the guests", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: at(9) });
    eventsByQuery["calendar:today"] = [review([me({ is_organizer: true }), ...declined()])];
    handlers.delete_calendar_event = () => null;
    render(() => <App />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel Pricing page review" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Cancel and notify 3 guests?");
    expect(invoke.mock.calls.some(([cmd]) => cmd === "delete_calendar_event")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel event" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_calendar_event", { accountId: "a", calendarId: "primary", eventId: "Pricing page review", scope: "this" }));
    await waitFor(() => expect(screen.queryByText("Pricing page review")).toBeNull());
  });

  it("keeps the event when the organizer thinks better of cancelling", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: at(9) });
    eventsByQuery["calendar:today"] = [review([me({ is_organizer: true }), ...declined()])];
    render(() => <App />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel Pricing page review" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(invoke.mock.calls.some(([cmd]) => cmd === "delete_calendar_event")).toBe(false);
  });

  it("opens the event's edit on its start time to reschedule", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: at(9) });
    eventsByQuery["calendar:today"] = [review([me({ is_organizer: true }), ...declined()])];
    render(() => <App />);

    fireEvent.click(await screen.findByRole("button", { name: "Reschedule Pricing page review" }));
    const start = await screen.findByRole("combobox", { name: "Start" });
    await waitFor(() => expect(document.activeElement).toBe(start));
    expect(start).toHaveValue("3:00 PM");
    expect(screen.getByRole("heading", { name: "Pricing page review" })).toBeInTheDocument();
  });

  it("tells a guest everyone else declined, with nothing to act on from the row", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: at(9) });
    eventsByQuery["calendar:today"] = [review(
      [me(), person("lucia@x.com", "declined", { is_organizer: true }), person("jules@x.com", "declined")],
      { organizer: "lucia@x.com", can_edit: false },
    )];
    render(() => <App />);

    expect(await screen.findByText("Everyone else declined")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Reschedule|Cancel) / })).toBeNull();
  });

  it("says nothing while anyone might still come, for just the user and a room, or while noticing is off", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: at(9) });
    eventsByQuery["calendar:today"] = [
      review([me({ is_organizer: true }), person("jules@x.com", "declined"), person("priya@x.com", "needsAction")]),
      event("Focus time", at(11), at(12), { attendees: [me({ is_organizer: true }), ROOM] }),
    ];
    render(() => <App />);

    await screen.findByText("Focus time");
    expect(within(row("Pricing page review")).getByText("Sala Norte")).toBeInTheDocument();
    expect(document.querySelector(".calendar-event-alone")).toBeNull();
  });

  it("says nothing while the user has turned noticing off", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: at(9) });
    setNoticesEnabled(false);
    eventsByQuery["calendar:today"] = [review([me({ is_organizer: true }), ...declined()])];
    render(() => <App />);

    await screen.findByText("Pricing page review");
    expect(document.querySelector(".calendar-event-alone")).toBeNull();
  });
});
