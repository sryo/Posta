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

const person = (email: string, extra: Partial<GoogleCalendarEvent["attendees"][number]> = {}) =>
  ({ email, display_name: null, response_status: "needsAction", is_organizer: false, is_self: false, ...extra });

// The user's own event
const event: GoogleCalendarEvent = {
  id: "e1",
  calendar_id: "primary",
  calendar_name: "Work",
  title: "Sync",
  description: null,
  location: null,
  // Tomorrow: a meeting still to come offers to join it
  start_time: Date.now() + 24 * 60 * 60 * 1000,
  end_time: null,
  all_day: false,
  status: "confirmed",
  organizer: "me@example.com",
  attendees: [],
  html_link: "https://calendar.google.com/x",
  hangout_link: "https://meet.google.com/x",
  response_status: null,
  can_edit: true,
};

// Someone else's event the user is invited to
const invite: GoogleCalendarEvent = {
  ...event,
  organizer: "boss@example.com",
  can_edit: false,
  response_status: "needsAction",
  attendees: [person("boss@example.com", { is_organizer: true }), person("me@example.com", { is_self: true })],
};

const baseProps = {
  cardId: "c1",
  selectedCount: 0,
  open: true,
  onClose: vi.fn(),
  selectedAccount: () => ({ id: "acc", email: "me@example.com" } as any),
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
  showFailure: vi.fn(),
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

  it("shows Escape as its symbol on Clear, so every hint stays a round pill", () => {
    render(() => <ActionsWheel {...baseProps} threadId="t1" thread={thread} selectedCount={2} selectedThreads={() => ({ c1: new Set(["t1", "t2"]) })} />);
    expect(hint("Clear")).toBe("⎋");
    for (const el of Array.from(document.querySelectorAll(".action-key-hint"))) {
      expect(el.textContent!.length, el.textContent!).toBeLessThanOrEqual(2);
    }
  });

  it("does not advertise unbound keys on event actions", () => {
    render(() => <ActionsWheel {...baseProps} event={invite} onDeleteEvent={vi.fn()} />);
    expect(hint("Reply to organizer")).toBe("r");
    expect(hint("Join meeting")).toBeNull();
    expect(hint("Open in Calendar")).toBeNull();
  });

  it("does not advertise a key for deleting an event", () => {
    render(() => <ActionsWheel {...baseProps} event={event} onDeleteEvent={vi.fn()} />);
    expect(hint("Delete")).toBeNull();
  });
});

describe("ActionsWheel event actions follow the user's role", () => {
  it("offers no RSVP or reply on the user's own solo event", () => {
    render(() => <ActionsWheel {...baseProps} event={event} onDeleteEvent={vi.fn()} />);
    expect(screen.queryByTitle("Going")).toBeNull();
    expect(screen.queryByTitle("Not going")).toBeNull();
    expect(screen.queryByTitle("Reply to organizer")).toBeNull();
    expect(screen.getByTitle("Delete")).toBeInTheDocument();
  });

  it("offers an organizer a note to the guests instead of a reply", () => {
    const openEventQuickReply = vi.fn();
    render(() => <ActionsWheel {...baseProps} openEventQuickReply={openEventQuickReply} event={{ ...event, attendees: [person("a@example.com")] }} onDeleteEvent={vi.fn()} />);
    fireEvent.click(screen.getByTitle("Email guests"));
    expect(openEventQuickReply).toHaveBeenCalledWith("e1");
    expect(screen.getByTitle("Delete")).toBeInTheDocument();
  });

});

describe("ActionsWheel event delete", () => {
  afterEach(() => vi.restoreAllMocks());

  it("deletes an event the user can edit on one click, without a native confirm", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onDeleteEvent = vi.fn();
    const onClose = vi.fn();
    render(() => <ActionsWheel {...baseProps} onClose={onClose} selectedAccount={() => ({ id: "acc" } as any)} event={event} onDeleteEvent={onDeleteEvent} />);
    fireEvent.click(screen.getByTitle("Delete"));
    expect(onDeleteEvent).toHaveBeenCalledWith(event, { left: expect.any(Number), bottom: expect.any(Number) });
    expect(onClose).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(rsvpListedCalendarEvent).not.toHaveBeenCalled();
  });

  it("does not delete again on the second click of a double click", () => {
    const onDeleteEvent = vi.fn();
    render(() => <ActionsWheel {...baseProps} event={event} onDeleteEvent={onDeleteEvent} />);
    fireEvent.click(screen.getByTitle("Delete"), { detail: 1 });
    fireEvent.click(screen.getByTitle("Delete"), { detail: 2 });
    expect(onDeleteEvent).toHaveBeenCalledTimes(1);
  });

  it("offers no delete on events the user cannot edit, where Not going already declines", () => {
    render(() => <ActionsWheel {...baseProps} event={invite} onDeleteEvent={vi.fn()} />);
    expect(screen.queryByTitle("Delete")).toBeNull();
    expect(screen.getByTitle("Not going")).toBeInTheDocument();
  });
});

describe("ActionsWheel event RSVP", () => {
  it("answers a recurring occurrence on its own calendar by its listed id", async () => {
    rsvpListedCalendarEvent.mockReset().mockResolvedValue(null);
    const onRsvped = vi.fn();
    const showToast = vi.fn();
    render(() => <ActionsWheel {...baseProps} showToast={showToast} selectedAccount={() => ({ id: "acc" } as any)} event={{ ...invite, id: "e1_20260928T150000Z", calendar_id: "team@x.com" }} onRsvped={onRsvped} />);
    fireEvent.click(screen.getByTitle("Going"));
    await vi.waitFor(() => expect(onRsvped).toHaveBeenCalledWith("e1_20260928T150000Z", "accepted"));
    expect(rsvpListedCalendarEvent).toHaveBeenCalledWith("acc", "team@x.com", "e1_20260928T150000Z", "accepted");
    expect(showToast).toHaveBeenCalledWith(`You're going to “${invite.title}”`);
  });

  it("reports the new response once the RSVP succeeds", async () => {
    rsvpListedCalendarEvent.mockReset().mockResolvedValue(null);
    const onRsvped = vi.fn();
    render(() => <ActionsWheel {...baseProps} selectedAccount={() => ({ id: "acc" } as any)} event={invite} onRsvped={onRsvped} />);
    fireEvent.click(screen.getByTitle("Going"));
    await vi.waitFor(() => expect(onRsvped).toHaveBeenCalledWith(invite.id, "accepted"));
    fireEvent.click(screen.getByTitle("Not going"));
    await vi.waitFor(() => expect(onRsvped).toHaveBeenCalledWith(invite.id, "declined"));
  });

  it("does not report a response when the RSVP fails", async () => {
    rsvpListedCalendarEvent.mockReset().mockRejectedValue(new Error("offline"));
    const onRsvped = vi.fn();
    const showFailure = vi.fn();
    render(() => <ActionsWheel {...baseProps} showFailure={showFailure} selectedAccount={() => ({ id: "acc" } as any)} event={invite} onRsvped={onRsvped} />);
    fireEvent.click(screen.getByTitle("Going"));
    await vi.waitFor(() => expect(showFailure).toHaveBeenCalledWith(`Couldn't send your RSVP to “${invite.title}”`, new Error("offline")));
    expect(onRsvped).not.toHaveBeenCalled();
  });

  it("sends one RSVP at a time however often the buttons are clicked", async () => {
    let finish!: () => void;
    rsvpListedCalendarEvent.mockReset().mockReturnValue(new Promise<void>(r => { finish = r; }));
    const onRsvped = vi.fn();
    render(() => <ActionsWheel {...baseProps} selectedAccount={() => ({ id: "acc" } as any)} event={invite} onRsvped={onRsvped} />);
    fireEvent.click(screen.getByTitle("Going"));
    fireEvent.click(screen.getByTitle("Going"));
    fireEvent.click(screen.getByTitle("Not going"));
    expect(rsvpListedCalendarEvent).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(onRsvped).toHaveBeenCalledTimes(1));
    rsvpListedCalendarEvent.mockResolvedValue(null);
    fireEvent.click(screen.getByTitle("Not going"));
    await vi.waitFor(() => expect(onRsvped).toHaveBeenLastCalledWith(invite.id, "declined"));
  });
});

describe("ActionsWheel join", () => {
  it("offers no join once the meeting is over", () => {
    render(() => <ActionsWheel {...baseProps} event={{ ...event, hangout_link: "https://meet.google.com/x", start_time: Date.now() - 2 * 3_600_000 }} onDeleteEvent={vi.fn()} />);
    expect(screen.queryByTitle("Join meeting")).toBeNull();
  });
});
