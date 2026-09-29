import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { ActionsWheel } from "./ActionsWheel";
import type { GoogleCalendarEvent, Thread } from "../api/tauri";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
const rsvpListedCalendarEvent = vi.hoisted(() => vi.fn());
vi.mock("../api/tauri", () => ({ rsvpListedCalendarEvent }));

const thread: Thread = {
  gmail_thread_id: "t1",
  account_id: "acc",
  subject: "Hi",
  snippet: "",
  last_message_date: 0,
  unread_count: 0,
  labels: ["INBOX"],
  participants: [],
  has_attachment: false,
  attachments: [],
  calendar_event: null,
};

const event: GoogleCalendarEvent = {
  id: "e1",
  calendar_id: "primary",
  calendar_name: "Work",
  title: "Sync",
  description: null,
  location: null,
  start_time: 0,
  end_time: null,
  all_day: false,
  status: "confirmed",
  organizer: "boss@example.com",
  attendees: [],
  html_link: "https://calendar.google.com/x",
  hangout_link: "https://meet.google.com/x",
  response_status: null,
  can_edit: true,
};

const baseProps = {
  cardId: "c1",
  selectedCount: 0,
  open: true,
  onClose: vi.fn(),
  selectedAccount: () => null,
  actionSettings: () => ({ archive: true, star: true, trash: true, spam: true, markRead: true, markImportant: true }),
  actionOrder: () => ["quickReply", "quickForward", "archive", "star", "markRead", "markImportant", "spam", "trash"],
  eventActionSettings: () => ({ joinMeeting: true, openCalendar: true, rsvpYes: true, rsvpNo: true, delete: true }),
  eventActionOrder: () => ["quickReply", "joinMeeting", "openCalendar", "rsvpYes", "rsvpNo", "delete"],
  selectedThreads: () => ({}),
  setSelectedThreads: vi.fn(),
  selectedEvents: () => ({}),
  setSelectedEvents: vi.fn(),
  openThreadQuickReply: vi.fn(),
  openEventQuickReply: vi.fn(),
  startBatchReply: vi.fn(),
  handleForward: vi.fn(),
  handleThreadAction: vi.fn(),
  showToast: vi.fn(),
};

const hint = (title: string) => screen.getByTitle(title).querySelector(".action-key-hint")?.textContent ?? null;

// Hints must name keys the card list actually binds (App's global handler):
// x selects a thread and j/k move focus, so they cannot stand for actions here
describe("ActionsWheel key hints", () => {
  it("shows the thread-list shortcuts", () => {
    render(() => <ActionsWheel {...baseProps} threadId="t1" thread={thread} />);
    expect(hint("Reply")).toBe("r");
    expect(hint("Forward")).toBe("f");
    expect(hint("Archive")).toBe("a");
    expect(hint("Star")).toBe("s");
    expect(hint("Delete")).toBe("d");
    expect(hint("Report spam")).toBe("!");
  });

  it("does not advertise unbound keys on event actions", () => {
    render(() => <ActionsWheel {...baseProps} event={event} onDeleteEvent={vi.fn()} />);
    expect(hint("Reply to organizer")).toBe("r");
    expect(hint("Join meeting")).toBeNull();
    expect(hint("Open in Calendar")).toBeNull();
    expect(hint("RSVP Yes")).toBeNull();
    expect(hint("RSVP No")).toBeNull();
    expect(hint("Delete")).toBeNull();
  });
});

describe("ActionsWheel event delete", () => {
  afterEach(() => vi.restoreAllMocks());

  it("deletes an event the user can edit on a second click, without a native confirm", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onDeleteEvent = vi.fn();
    const onClose = vi.fn();
    render(() => <ActionsWheel {...baseProps} onClose={onClose} selectedAccount={() => ({ id: "acc" } as any)} event={event} onDeleteEvent={onDeleteEvent} />);
    fireEvent.click(screen.getByTitle("Delete"));
    expect(onDeleteEvent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("Click again to delete Sync"));
    expect(onDeleteEvent).toHaveBeenCalledWith(event);
    expect(onClose).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(rsvpListedCalendarEvent).not.toHaveBeenCalled();
  });

  it("does not take the second click of a double click as the confirmation", () => {
    const onDeleteEvent = vi.fn();
    render(() => <ActionsWheel {...baseProps} event={event} onDeleteEvent={onDeleteEvent} />);
    fireEvent.click(screen.getByTitle("Delete"), { detail: 1 });
    fireEvent.click(screen.getByTitle("Click again to delete Sync"), { detail: 2 });
    expect(onDeleteEvent).not.toHaveBeenCalled();
  });

  it("keeps the event when another action is clicked in between", () => {
    rsvpListedCalendarEvent.mockReset().mockResolvedValue(null);
    const onDeleteEvent = vi.fn();
    render(() => <ActionsWheel {...baseProps} event={event} onDeleteEvent={onDeleteEvent} />);
    fireEvent.click(screen.getByTitle("Delete"));
    fireEvent.click(screen.getByTitle("Join meeting"));
    fireEvent.click(screen.getByTitle("Delete"));
    expect(onDeleteEvent).not.toHaveBeenCalled();
  });

  it("offers no delete on events the user cannot edit, where RSVP No already declines", () => {
    render(() => <ActionsWheel {...baseProps} event={{ ...event, can_edit: false }} onDeleteEvent={vi.fn()} />);
    expect(screen.queryByTitle("Delete")).toBeNull();
    expect(screen.getByTitle("RSVP No")).toBeInTheDocument();
  });
});

describe("ActionsWheel event RSVP", () => {
  it("answers a recurring occurrence on its own calendar by its listed id", async () => {
    rsvpListedCalendarEvent.mockReset().mockResolvedValue(null);
    const onRsvped = vi.fn();
    const showToast = vi.fn();
    render(() => <ActionsWheel {...baseProps} showToast={showToast} selectedAccount={() => ({ id: "acc" } as any)} event={{ ...event, id: "e1_20260928T150000Z", calendar_id: "team@x.com" }} onRsvped={onRsvped} />);
    fireEvent.click(screen.getByTitle("RSVP Yes"));
    await vi.waitFor(() => expect(onRsvped).toHaveBeenCalledWith("e1_20260928T150000Z", "accepted"));
    expect(rsvpListedCalendarEvent).toHaveBeenCalledWith("acc", "team@x.com", "e1_20260928T150000Z", "accepted");
    expect(showToast).toHaveBeenCalledWith("You're going");
  });

  it("reports the new response once the RSVP succeeds", async () => {
    rsvpListedCalendarEvent.mockReset().mockResolvedValue(null);
    const onRsvped = vi.fn();
    render(() => <ActionsWheel {...baseProps} selectedAccount={() => ({ id: "acc" } as any)} event={event} onRsvped={onRsvped} />);
    fireEvent.click(screen.getByTitle("RSVP Yes"));
    await vi.waitFor(() => expect(onRsvped).toHaveBeenCalledWith(event.id, "accepted"));
    fireEvent.click(screen.getByTitle("RSVP No"));
    await vi.waitFor(() => expect(onRsvped).toHaveBeenCalledWith(event.id, "declined"));
  });

  it("does not report a response when the RSVP fails", async () => {
    rsvpListedCalendarEvent.mockReset().mockRejectedValue(new Error("offline"));
    const onRsvped = vi.fn();
    const showToast = vi.fn();
    render(() => <ActionsWheel {...baseProps} showToast={showToast} selectedAccount={() => ({ id: "acc" } as any)} event={event} onRsvped={onRsvped} />);
    fireEvent.click(screen.getByTitle("RSVP Yes"));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith("Couldn't RSVP: offline"));
    expect(onRsvped).not.toHaveBeenCalled();
  });

  it("sends one RSVP at a time however often the buttons are clicked", async () => {
    let finish!: () => void;
    rsvpListedCalendarEvent.mockReset().mockReturnValue(new Promise<void>(r => { finish = r; }));
    const onRsvped = vi.fn();
    render(() => <ActionsWheel {...baseProps} selectedAccount={() => ({ id: "acc" } as any)} event={event} onRsvped={onRsvped} />);
    fireEvent.click(screen.getByTitle("RSVP Yes"));
    fireEvent.click(screen.getByTitle("RSVP Yes"));
    fireEvent.click(screen.getByTitle("RSVP No"));
    expect(rsvpListedCalendarEvent).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(onRsvped).toHaveBeenCalledTimes(1));
    rsvpListedCalendarEvent.mockResolvedValue(null);
    fireEvent.click(screen.getByTitle("RSVP No"));
    await vi.waitFor(() => expect(onRsvped).toHaveBeenLastCalledWith(event.id, "declined"));
  });
});
