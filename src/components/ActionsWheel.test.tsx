import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { ActionsWheel } from "./ActionsWheel";
import type { GoogleCalendarEvent, Thread } from "../api/tauri";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

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
    expect(hint("Report spam")).toBeNull();
  });

  it("does not advertise unbound keys on event actions", () => {
    render(() => <ActionsWheel {...baseProps} event={event} />);
    expect(hint("Reply to organizer")).toBe("r");
    expect(hint("Join meeting")).toBeNull();
    expect(hint("Open in Calendar")).toBeNull();
    expect(hint("RSVP Yes")).toBeNull();
    expect(hint("RSVP No")).toBeNull();
    expect(hint("Delete")).toBeNull();
  });
});
