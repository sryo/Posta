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
    // A fresh copy each time, as from the backend: the store reconciles
    // into what it was given
    fetch_threads_paginated: ({ cardId }) => ({
      groups: [{ label: "Today", threads: structuredClone(threadsByCard[cardId as string] ?? []) }],
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

describe("New mail waits for the pointer", () => {
  const fetches = () => invoke.mock.calls.filter(([cmd, args]) => cmd === "fetch_threads_paginated" && (args as { cardId: string }).cardId === "inbox").length;
  const subjects = () => Array.from(cardRegion("Inbox").querySelectorAll(".thread"), row => row.querySelector(".thread-subject")?.textContent ?? row.textContent);
  async function mailArrives() {
    const before = fetches();
    const arrived = thread("t-new", "Fresh mail", { unread_count: 1 });
    threadsByCard.inbox = [arrived, ...threadsByCard.inbox];
    handlers.sync_threads_incremental = () => ({ modified_threads: [arrived], deleted_thread_ids: [], is_full_sync: false });
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(fetches()).toBeGreaterThan(before));
    await new Promise(r => setTimeout(r, 20));
  }

  it("keeps the rows still under a resting pointer, and lets the new ones in once it leaves the card", async () => {
    render(() => <App />);
    await screen.findByText("Second");
    await new Promise(r => setTimeout(r, 20));
    fireEvent.pointerEnter(cardRegion("Inbox"));
    await mailArrives();

    expect(screen.queryByText("Fresh mail")).toBeNull();
    expect(subjects()).toEqual(["First", "Second"]);
    expect(cardRegion("Inbox")).not.toHaveTextContent(/new|waiting|appear/i);

    fireEvent.pointerLeave(cardRegion("Inbox"));
    expect(screen.queryByText("Fresh mail")).toBeNull();
    await screen.findByText("Fresh mail");
    expect(subjects()).toEqual(["Fresh mail", "First", "Second"]);
  });

  it("counts the waiting mail as unread in the card's badge", async () => {
    render(() => <App />);
    await screen.findByText("Second");
    await new Promise(r => setTimeout(r, 20));
    fireEvent.pointerEnter(cardRegion("Inbox"));
    await mailArrives();
    expect(within(cardRegion("Inbox")).getAllByText("1").some(el => el.classList.contains("card-unread-badge"))).toBe(true);
  });

  it("holds while the keyboard focus is in the card, and lets go as the focus leaves it", async () => {
    render(() => <App />);
    await screen.findByText("Receipt two");
    await new Promise(r => setTimeout(r, 20));
    setInputMode("keyboard");
    row("Second").focus();
    await mailArrives();
    expect(screen.queryByText("Fresh mail")).toBeNull();
    expect(row("Second")).toHaveClass("focused");

    row("Receipt one").focus();
    await screen.findByText("Fresh mail");
  });

  it("doesn't hold for a row a click left focused once the pointer is gone", async () => {
    render(() => <App />);
    await screen.findByText("Second");
    await new Promise(r => setTimeout(r, 20));
    row("Second").focus();
    await mailArrives();
    await screen.findByText("Fresh mail");
  });

  it("lets go of the keyboard's hold when the pointer takes over", async () => {
    render(() => <App />);
    await screen.findByText("Second");
    await new Promise(r => setTimeout(r, 20));
    setInputMode("keyboard");
    row("Second").focus();
    await mailArrives();
    expect(screen.queryByText("Fresh mail")).toBeNull();
    setInputMode("pointer");
    await screen.findByText("Fresh mail");
  });

  it("lets new mail straight in when nothing rests on the card", async () => {
    render(() => <App />);
    await screen.findByText("Second");
    await new Promise(r => setTimeout(r, 20));
    await mailArrives();
    await screen.findByText("Fresh mail");
  });
});

describe("Where it went", () => {
  const rowsOf = (name: string) => Array.from(cardRegion(name).querySelectorAll(".thread"), el => el.querySelector(".thread-subject")?.textContent);
  beforeEach(() => {
    boardCards = [card("inbox", "Inbox"), { ...card("starred", "Starred", "is:starred"), position: 1 }];
    const hour = 3600000;
    const today = new Date().setHours(12, 0, 0, 0);
    threadsByCard.inbox = [thread("t-1", "First", { last_message_date: today }), thread("t-2", "Second", { last_message_date: today - hour })];
    threadsByCard.starred = [thread("s-1", "Old star", { labels: ["STARRED"], last_message_date: today - 3 * hour })];
  });

  it("puts a starred thread into the Starred card in its date order at once", async () => {
    render(() => <App />);
    await screen.findByText("Old star");
    await new Promise(r => setTimeout(r, 20));
    press("l");
    press("j");
    press("s");
    await waitFor(() => expect(rowsOf("Starred")).toEqual(["Second", "Old star"]));
    expect(rowsOf("Inbox")).toEqual(["First", "Second"]);
  });

  it("takes it back out of the card it went to when the change fails", async () => {
    handlers.modify_threads = () => { throw new Error("offline"); };
    render(() => <App />);
    await screen.findByText("Old star");
    await new Promise(r => setTimeout(r, 20));
    press("l");
    press("j");
    press("s");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("modify_threads", expect.anything()));
    await waitFor(() => expect(rowsOf("Starred")).toEqual(["Old star"]));
  });

  it("takes it back out when the star is undone", async () => {
    render(() => <App />);
    await screen.findByText("Old star");
    await new Promise(r => setTimeout(r, 20));
    press("l");
    press("j");
    press("s");
    await waitFor(() => expect(rowsOf("Starred")).toEqual(["Second", "Old star"]));
    await screen.findByRole("button", { name: /undo/i });
    press("z");
    await waitFor(() => expect(rowsOf("Starred")).toEqual(["Old star"]));
  });

  it("puts a thread only into a card whose query its labels answer", async () => {
    boardCards.push({ ...card("from-ana", "Ana", "from:ana@x.com is:starred"), position: 2 });
    threadsByCard["from-ana"] = [];
    render(() => <App />);
    await screen.findByText("Old star");
    await new Promise(r => setTimeout(r, 20));
    press("l");
    press("j");
    press("s");
    await waitFor(() => expect(rowsOf("Starred")).toEqual(["Second", "Old star"]));
    expect(rowsOf("Ana")).toEqual([]);
  });
});

describe("Drop it on a card", () => {
  const rowsOf = (name: string) => Array.from(cardRegion(name).querySelectorAll(".thread"), el => el.querySelector(".thread-subject")?.textContent);
  const header = (name: string) => cardRegion(name).querySelector<HTMLElement>(".card-header")!;
  const pointer = (type: string, target: EventTarget, init: PointerEventInit = {}) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, ...init }));
  let under: Element | null = null;

  beforeEach(() => {
    under = null;
    document.elementFromPoint = () => under;
    handlers.list_labels = () => [{ id: "Label_1", name: "Receipts", label_type: "user", messageListVisibility: null, labelListVisibility: null }];
    const today = new Date().setHours(12, 0, 0, 0);
    threadsByCard.inbox = [thread("t-1", "First", { last_message_date: today }), thread("t-2", "Second", { last_message_date: today - 7200000 })];
    threadsByCard.receipts = [thread("r-1", "Receipt one", { labels: ["Label_1"], last_message_date: today - 3600000 })];
  });

  async function dragOnto(subject: string, card: string, init: PointerEventInit = {}) {
    pointer("pointerdown", row(subject), { clientX: 10, clientY: 10 });
    under = header(card);
    pointer("pointermove", document, { clientX: 400, clientY: 40, ...init });
  }

  it("says in the card's header what dropping there does, which ⌥ changes", async () => {
    render(() => <App />);
    await screen.findByText("Receipt one");
    await dragOnto("Second", "Receipts");
    await waitFor(() => expect(header("Receipts")).toHaveTextContent("Label Receipts · leaves Inbox ⌥ keeps it"));
    expect(cardRegion("Receipts")).toHaveClass("drop-target");

    pointer("pointermove", document, { clientX: 401, clientY: 40, altKey: true });
    expect(header("Receipts")).toHaveTextContent("Label Receipts · stays in Inbox");
    expect(header("Receipts")).not.toHaveTextContent("⌥");
  });

  it("files the thread under the card's label, in date order there, with an Undo", async () => {
    render(() => <App />);
    await screen.findByText("Receipt one");
    await dragOnto("Second", "Receipts");
    await waitFor(() => expect(header("Receipts")).toHaveTextContent("Label Receipts"));
    pointer("pointerup", document, { clientX: 400, clientY: 40 });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("modify_threads", { accountId: "a", threadIds: ["t-2"], addLabels: ["Label_1"], removeLabels: ["INBOX"] }));
    await waitFor(() => expect(rowsOf("Receipts")).toEqual(["Receipt one", "Second"]));
    expect(rowsOf("Inbox")).toEqual(["First"]);
    expect(await screen.findByText("Labelled Receipts, out of Inbox")).toBeInTheDocument();
    expect(cardRegion("Receipts")).not.toHaveClass("drop-target");

    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("modify_threads", { accountId: "a", threadIds: ["t-2"], addLabels: ["INBOX"], removeLabels: ["Label_1"] }));
  });

  it("says plainly when a card can't take mail, and a drop there does nothing", async () => {
    boardCards.push({ ...card("ana", "Ana", "from:ana@x.com"), position: 2 });
    threadsByCard.ana = [];
    render(() => <App />);
    await screen.findByText("Receipt one");
    await dragOnto("Second", "Ana");
    await waitFor(() => expect(header("Ana")).toHaveTextContent("Can't add mail to Ana"));
    pointer("pointerup", document, { clientX: 400, clientY: 40 });
    await new Promise(r => setTimeout(r, 50));
    expect(invoke).not.toHaveBeenCalledWith("modify_threads", expect.anything());
    expect(rowsOf("Inbox")).toEqual(["First", "Second"]);
  });

  it("opens a new event at the time the subject names when dropped on a calendar card", async () => {
    boardCards.push({ ...card("week", "This week", "calendar:week"), position: 2 });
    threadsByCard.inbox = [thread("t-1", "Call on Friday at 3pm", { participants: ["Tomás Ruiz <tomas@x.com>"] })];
    render(() => <App />);
    await screen.findByText("Call on Friday at 3pm");
    pointer("pointerdown", row("Call on Friday at 3pm"), { clientX: 10, clientY: 10 });
    under = screen.getByRole("region", { name: "This week calendar card" });
    pointer("pointermove", document, { clientX: 400, clientY: 40 });
    await waitFor(() => expect(under).toHaveTextContent(/New event · .*3:00 PM|15:00.* with Tomás/));
    pointer("pointerup", document, { clientX: 400, clientY: 40 });
    expect(await screen.findByDisplayValue("Call on Friday at 3pm")).toBeInTheDocument();
  });

  it("opens no row's wheel while a thread is dragged over it", async () => {
    render(() => <App />);
    await screen.findByText("Receipt one");
    await dragOnto("Second", "Receipts");
    fireEvent.mouseEnter(row("Receipt one"));
    await new Promise(r => setTimeout(r, 400));
    expect(row("Receipt one").querySelector(".radial-menu")).toBeNull();
  });

  it("opens no event's wheel while a thread is dragged over it", async () => {
    localStorage.setItem("eventActionSettings", JSON.stringify({ delete: true }));
    const start = new Date(); start.setDate(start.getDate() + 1); start.setHours(10, 0, 0, 0);
    boardCards.push({ ...card("week", "This week", "calendar:week"), position: 2 });
    handlers.fetch_calendar_events = () => [{
      id: "e-1", calendar_id: "primary", calendar_name: "Main", title: "Standup", description: null, location: null,
      start_time: start.getTime(), end_time: start.getTime() + 3600000, all_day: false, status: "confirmed",
      organizer: "org@x.com", attendees: [], html_link: null, hangout_link: null, response_status: null, can_edit: true,
    }];
    render(() => <App />);
    const standup = (await screen.findByText("Standup")).closest<HTMLElement>(".calendar-event-item")!;
    pointer("pointerdown", row("Second"), { clientX: 10, clientY: 10 });
    under = standup;
    pointer("pointermove", document, { clientX: 400, clientY: 40 });
    fireEvent.mouseEnter(standup);
    await new Promise(r => setTimeout(r, 400));
    expect(within(standup).queryByTitle("Delete")).toBeNull();
  });

  it("doesn't open the thread when a drag ends on its row", async () => {
    render(() => <App />);
    await screen.findByText("Receipt one");
    pointer("pointerdown", row("Second"), { clientX: 10, clientY: 10 });
    under = row("Second");
    pointer("pointermove", document, { clientX: 30, clientY: 10 });
    pointer("pointerup", document, { clientX: 30, clientY: 10 });
    fireEvent.click(row("Second"));
    await new Promise(r => setTimeout(r, 50));
    expect(invoke).not.toHaveBeenCalledWith("get_thread_details", expect.anything());
  });
});
