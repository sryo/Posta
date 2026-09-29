import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
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

function baseProps() {
  return {
    event: event as GoogleCalendarEvent | null,
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
}

function renderEvent(overrides: Partial<GoogleCalendarEvent> = {}) {
  const props = { ...baseProps(), event: { ...event, ...overrides } };
  const { container } = render(() => <EventView {...props} />);
  return Object.assign(props, { container });
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

describe("EventView delete", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  // window.confirm returns false without a dialog in the macOS webview
  it("asks for a second press instead of a native confirm before deleting", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const props = renderEvent();
    fireEvent.click(screen.getByTitle("Delete event"));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.getByTitle(/again to delete/)).toHaveTextContent("Confirm");
    fireEvent.click(screen.getByTitle(/again to delete/));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("deletes with the # and d keys pressed twice", () => {
    const props = renderEvent();
    fireEvent.keyDown(document, { key: "#" });
    expect(props.onDelete).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "d" });
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it("does not take a held key or a double click as the second press", () => {
    const props = renderEvent();
    fireEvent.keyDown(document, { key: "d" });
    fireEvent.keyDown(document, { key: "d", repeat: true });
    fireEvent.click(screen.getByTitle(/again to delete/), { detail: 2 });
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("disarms on Escape without closing the event", () => {
    const props = renderEvent();
    fireEvent.keyDown(document, { key: "d" });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "d" });
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(props.container.querySelector(".thread-overlay.closing")).toBeNull();
    expect(screen.getByTitle(/again to delete/)).toBeInTheDocument();
  });

  it("does not carry a pending delete over to another event", () => {
    const [current, setCurrent] = createSignal<GoogleCalendarEvent>(event);
    const onDelete = vi.fn();
    render(() => <EventView {...baseProps()} event={current()} onDelete={onDelete} />);
    fireEvent.keyDown(document, { key: "d" });
    setCurrent({ ...event, id: "e2", title: "Other" });
    fireEvent.keyDown(document, { key: "d" });
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("disarms by itself after a few seconds", () => {
    vi.useFakeTimers();
    const props = renderEvent();
    fireEvent.click(screen.getByTitle("Delete event"));
    vi.advanceTimersByTime(5000);
    expect(screen.getByTitle("Delete event")).toHaveTextContent("Delete");
    fireEvent.click(screen.getByTitle("Delete event"));
    expect(props.onDelete).not.toHaveBeenCalled();
  });
});

describe("EventView description", () => {
  const description = (container: HTMLElement) => container.querySelector(".message-body > div")!;

  it("keeps line breaks of a plain-text description and shows angle brackets literally", () => {
    const { container } = renderEvent({ description: "Agenda:\n1. Intro <5 min>\n2. Demo" });
    const el = description(container);
    expect(el.textContent).toContain("Agenda:\n1. Intro <5 min>\n2. Demo");
    expect(el.querySelector("[style*='pre-wrap']")).not.toBeNull();
  });

  it("renders an HTML description without turning source newlines into extra breaks", () => {
    const { container } = renderEvent({ description: "<p>Hello</p>\n<p>See <a href=\"https://x.test\">doc</a></p>" });
    const el = description(container);
    expect(el.querySelectorAll("br")).toHaveLength(0);
    expect(el.querySelectorAll("p")).toHaveLength(2);
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://x.test");
  });
});

describe("EventView video call", () => {
  it("offers the video call link as a button rather than an in-app href", async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    const { container } = renderEvent({ hangout_link: "https://meet.google.com/abc" });
    const join = container.querySelector(".event-info-row .link-btn") as HTMLButtonElement;
    expect(container.querySelector(".event-info-row a")).toBeNull();
    expect(join.tagName).toBe("BUTTON");
    expect(join.type).toBe("button");
    fireEvent.click(join);
    expect(openUrl).toHaveBeenCalledWith("https://meet.google.com/abc");
  });
});

const attendee = (email: string, response_status: string | null, extra: Partial<GoogleCalendarEvent["attendees"][number]> = {}) =>
  ({ email, display_name: null, response_status, is_organizer: false, is_self: false, ...extra });

describe("EventView guest list", () => {
  it("words each guest's answer, and says so when they haven't answered", () => {
    renderEvent({ attendees: [attendee("a@x.test", "declined"), attendee("b@x.test", "needsAction")] });
    expect(screen.getByText("a@x.test").closest(".event-attendee")).toHaveTextContent("Not going");
    expect(screen.getByText("b@x.test").closest(".event-attendee")).toHaveTextContent("Not answered");
  });
});

describe("EventView closing", () => {
  afterEach(() => vi.useRealTimers());

  it("closes once however often Escape is pressed during the closing animation", () => {
    vi.useFakeTimers();
    const props = renderEvent();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    vi.advanceTimersByTime(500);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
