import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { EventView } from "./EventView";
import type { GoogleCalendarEvent } from "../api/tauri";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const event: GoogleCalendarEvent = {
  id: "e1",
  calendar_id: "primary",
  calendar_name: "Work",
  title: "Standup",
  description: null,
  location: null,
  start_time: Date.UTC(2024, 0, 1, 10),
  end_time: Date.UTC(2024, 0, 1, 11),
  all_day: false,
  status: "confirmed",
  organizer: "boss@example.com",
  attendees: [],
  html_link: "https://calendar.google.com/x",
  hangout_link: null,
  response_status: null,
  can_edit: true,
};

function renderEvent() {
  const props = {
    event,
    card: null,
    focusColor: null,
    onClose: vi.fn(),
    onRsvp: vi.fn(),
    onReplyOrganizer: vi.fn(),
    onReplyAll: vi.fn(),
    onForward: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onOpenCalendars: vi.fn(),
    calendarDrawerOpen: false,
    onCloseCalendarDrawer: vi.fn(),
    calendars: [],
    calendarsLoading: false,
    onMoveToCalendar: vi.fn(),
    rsvpLoading: false,
    inlineCompose: null,
    inlineEdit: null,
  };
  render(() => <EventView {...props} />);
  return props;
}

describe("EventView keyboard shortcuts", () => {
  it("ignores Cmd/Ctrl combos such as Cmd+C copy and Cmd+D", () => {
    const props = renderEvent();
    fireEvent.keyDown(document, { key: "c", metaKey: true });
    fireEvent.keyDown(document, { key: "d", ctrlKey: true });
    fireEvent.keyDown(document, { key: "r", metaKey: true });
    expect(props.onOpenCalendars).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(props.onReplyOrganizer).not.toHaveBeenCalled();
  });

  it("handles the bare-key shortcuts", () => {
    const props = renderEvent();
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.keyDown(document, { key: "e" });
    fireEvent.keyDown(document, { key: "r" });
    expect(props.onOpenCalendars).toHaveBeenCalledTimes(1);
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    expect(props.onReplyOrganizer).toHaveBeenCalledTimes(1);
  });

  it("handles the reply-all and forward shortcuts shown on the actions wheel", () => {
    const props = renderEvent();
    fireEvent.keyDown(document, { key: "R", shiftKey: true });
    fireEvent.keyDown(document, { key: "f" });
    expect(props.onReplyAll).toHaveBeenCalledTimes(1);
    expect(props.onForward).toHaveBeenCalledTimes(1);
    expect(props.onReplyOrganizer).not.toHaveBeenCalled();
    expect(screen.getByTitle("Reply All")).toHaveTextContent("⇧R");
    expect(screen.getByTitle("Forward")).toHaveTextContent("F");
  });
});
