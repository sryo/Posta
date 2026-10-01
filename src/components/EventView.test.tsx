import { afterEach, describe, expect, it, vi } from "vitest";
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
  organizer: "me@example.com",
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
    accountEmail: "me@example.com",
    nameForEmail: undefined as ((email: string) => string | undefined) | undefined,
    calendars: [] as { id: string; name: string; is_primary: boolean; access_role: string }[],
    calendarsLoading: false,
    onMoveToCalendar: vi.fn(),
    rsvpLoading: false,
    inlineCompose: null,
    inlineEdit: null,
  };
}

function renderEvent(overrides: Partial<GoogleCalendarEvent> = {}, extraProps: Partial<ReturnType<typeof baseProps>> = {}) {
  const props = { ...baseProps(), ...extraProps, event: { ...event, ...overrides } };
  const { container } = render(() => <EventView {...props} />);
  return Object.assign(props, { container });
}

const person = (email: string, extra: Partial<GoogleCalendarEvent["attendees"][number]> = {}) =>
  ({ email, display_name: null, response_status: "needsAction", is_organizer: false, is_self: false, ...extra });

// Someone else's event the user is invited to
const invited: Partial<GoogleCalendarEvent> = {
  organizer: "boss@example.com",
  can_edit: false,
  response_status: "needsAction",
  attendees: [person("boss@example.com", { is_organizer: true, response_status: "accepted" }), person("me@example.com", { is_self: true })],
};

// The user's event with two guests
const hosting: Partial<GoogleCalendarEvent> = {
  attendees: [person("me@example.com", { is_self: true, is_organizer: true }), person("a@example.com"), person("b@example.com")],
};

const toolbarLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".thread-bar-actions .thread-toolbar-label")).map(el => el.textContent);

describe("EventView keys match the rest of the app", () => {
  afterEach(() => vi.clearAllMocks());

  it("joins the call with v, leaving j alone", async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    renderEvent({ hangout_link: "https://meet.google.com/abc" });
    fireEvent.keyDown(document, { key: "j" });
    expect(openUrl).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "v" });
    expect(openUrl).toHaveBeenCalledWith("https://meet.google.com/abc");
    expect(screen.getByTitle("Join video call")).toHaveTextContent("V");
  });

  it("moves the event with m, leaving c alone", () => {
    const props = renderEvent();
    fireEvent.keyDown(document, { key: "c" });
    expect(props.onOpenCalendars).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "m" });
    expect(props.onOpenCalendars).toHaveBeenCalledTimes(1);
    const move = screen.getByTitle("Move to calendar");
    expect(move.querySelector(".thread-toolbar-label")).toHaveTextContent("Move to…");
    expect(move.querySelector(".key-hint")).toHaveTextContent("M");
  });

  it("draws Move to… and Google Calendar with different icons", () => {
    renderEvent();
    const icon = (title: string) => screen.getByTitle(title).querySelector("svg")!.innerHTML;
    expect(icon("Move to calendar")).not.toBe(icon("Open in Google Calendar"));
  });

  it("closes the calendar drawer with m, as its footer says", () => {
    const props = renderEvent({}, { calendarDrawerOpen: true });
    expect(document.querySelector(".label-drawer-footer")).toHaveTextContent("M to close");
    fireEvent.keyDown(document, { key: "m" });
    expect(props.onCloseCalendarDrawer).toHaveBeenCalledTimes(1);
  });

  it("names the Google Calendar link for where it goes", () => {
    renderEvent();
    const link = screen.getByTitle("Open in Google Calendar");
    expect(link.querySelector(".thread-toolbar-label")).toHaveTextContent(/^Google Calendar$/);
    expect(link.querySelector("svg[data-icon=external]")).not.toBeNull();
  });

  it("answers an invite with y, ⇧M and n, and shows those keys", () => {
    const props = renderEvent(invited);
    fireEvent.keyDown(document, { key: "y" });
    fireEvent.keyDown(document, { key: "M", shiftKey: true });
    fireEvent.keyDown(document, { key: "n" });
    expect(props.onRsvp.mock.calls).toEqual([["accepted"], ["tentative"], ["declined"]]);
    expect(screen.getByRole("button", { name: "Going" })).toHaveAttribute("aria-keyshortcuts", "y");
  });

  it("does not answer for the user on an event they own", () => {
    const props = renderEvent();
    fireEvent.keyDown(document, { key: "y" });
    fireEvent.keyDown(document, { key: "n" });
    expect(props.onRsvp).not.toHaveBeenCalled();
  });

  it("does not repeat an answer the user already gave", () => {
    const props = renderEvent({ ...invited, response_status: "accepted" });
    fireEvent.keyDown(document, { key: "y" });
    expect(props.onRsvp).not.toHaveBeenCalled();
  });
});

describe("EventView actions follow the user's role", () => {
  it("lets the owner of a solo event edit, delete and move it, with no reply or RSVP", () => {
    const { container } = renderEvent();
    expect(toolbarLabels(container)).not.toContain("Reply");
    expect(toolbarLabels(container)).toEqual(expect.arrayContaining(["Edit", "Delete"]));
    expect(screen.getByTitle("Move to calendar")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Your response" })).toBeNull();
    expect(screen.queryByTitle("Reply")).toBeNull();
    expect(screen.queryByTitle("Reply All")).toBeNull();
    expect(screen.getByTitle("Forward")).toBeInTheDocument();
  });

  it("lets a guest answer and reply, but not move, edit or delete someone else's event", () => {
    const props = renderEvent(invited);
    expect(toolbarLabels(props.container)).toContain("Reply");
    expect(toolbarLabels(props.container)).not.toContain("Edit");
    expect(toolbarLabels(props.container)).not.toContain("Delete");
    expect(screen.queryByTitle("Move to calendar")).toBeNull();
    expect(screen.getByRole("group", { name: "Your response" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "m" });
    fireEvent.keyDown(document, { key: "e" });
    fireEvent.keyDown(document, { key: "d" });
    fireEvent.keyDown(document, { key: "d" });
    expect(props.onOpenCalendars).not.toHaveBeenCalled();
    expect(props.onEdit).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("lets an organizer email the guests", () => {
    const props = renderEvent(hosting);
    expect(toolbarLabels(props.container)).not.toContain("Reply");
    fireEvent.click(props.container.querySelector<HTMLElement>('.thread-bar-actions [title="Email guests"]')!);
    expect(props.onReplyAll).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "r" });
    expect(props.onReplyAll).toHaveBeenCalledTimes(2);
    expect(props.onReplyOrganizer).not.toHaveBeenCalled();
  });

  it("offers only calendars the user can write to as move targets", () => {
    renderEvent({}, {
      calendarDrawerOpen: true,
      calendars: [
        { id: "primary", name: "me@example.com", is_primary: true, access_role: "owner" },
        { id: "birthdays", name: "Birthdays", is_primary: false, access_role: "reader" },
        { id: "team", name: "Team", is_primary: false, access_role: "writer" },
      ],
    });
    const names = Array.from(document.querySelectorAll(".label-drawer .label-name")).map(el => el.textContent);
    expect(names).toEqual(["me@example.com", "Team"]);
  });

  it("opens the calendar drawer as a named dialog holding focus, still closing on m from a calendar choice, and on Escape", () => {
    const props = renderEvent({}, {
      calendarDrawerOpen: true,
      calendars: [{ id: "team", name: "Team", is_primary: false, access_role: "writer" }],
    });
    const drawer = screen.getByRole("dialog", { name: "Move to Calendar" });
    expect(drawer.contains(document.activeElement)).toBe(true);
    const radio = screen.getByRole("radio", { name: "Team" });
    fireEvent.keyDown(radio, { key: "m" });
    expect(props.onCloseCalendarDrawer).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(radio, { key: "e" });
    expect(props.onEdit).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(props.onCloseCalendarDrawer).toHaveBeenCalledTimes(2);
  });
});

describe("EventView keyboard shortcuts", () => {
  it("ignores Cmd/Ctrl combos such as Cmd+C copy and Cmd+D", () => {
    const props = renderEvent();
    fireEvent.keyDown(document, { key: "m", metaKey: true });
    fireEvent.keyDown(document, { key: "d", ctrlKey: true });
    fireEvent.keyDown(document, { key: "r", metaKey: true });
    expect(props.onOpenCalendars).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(props.onReplyOrganizer).not.toHaveBeenCalled();
  });

  it("handles the bare-key shortcuts", () => {
    const props = renderEvent();
    fireEvent.keyDown(document, { key: "m" });
    fireEvent.keyDown(document, { key: "e" });
    expect(props.onOpenCalendars).toHaveBeenCalledTimes(1);
    expect(props.onEdit).toHaveBeenCalledTimes(1);
  });

  it("replies to the organizer of an invite with r", () => {
    const props = renderEvent(invited);
    fireEvent.keyDown(document, { key: "r" });
    expect(props.onReplyOrganizer).toHaveBeenCalledTimes(1);
  });

  it("handles the reply-all and forward shortcuts shown on the actions wheel", () => {
    const props = renderEvent(invited);
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

  // The app offers Undo afterwards, or asks itself for events with guests
  it("deletes on one press, without a native confirm", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const props = renderEvent();
    fireEvent.click(screen.getByTitle("Delete event"));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("deletes with the # and d keys", () => {
    const props = renderEvent();
    fireEvent.keyDown(document, { key: "#" });
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "d" });
    expect(props.onDelete).toHaveBeenCalledTimes(2);
  });

  it("does not delete again on a held key or the second click of a double click", () => {
    const props = renderEvent();
    fireEvent.keyDown(document, { key: "d" });
    fireEvent.keyDown(document, { key: "d", repeat: true });
    fireEvent.click(screen.getByTitle("Delete event"), { detail: 2 });
    expect(props.onDelete).toHaveBeenCalledTimes(1);
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

describe("EventView organizer", () => {
  it("names the organizer from the guest list, keeping the address as a tooltip", () => {
    const { container } = renderEvent({
      organizer: "boss@example.com",
      attendees: [{ email: "boss@example.com", display_name: "Jules Martin", response_status: "accepted", is_self: false, is_organizer: true }],
    });
    const sender = container.querySelector(".message-header .message-sender")!;
    expect(sender.textContent).toBe("Jules Martin");
    expect(sender.getAttribute("title")).toBe("boss@example.com");
  });

  it("calls the user's own event theirs instead of repeating their address", () => {
    const { container } = renderEvent({ organizer: "ME@example.com" });
    expect(container.querySelector(".message-header .message-sender")!.textContent).toBe("You");
  });

  it("names an organizer missing from the guest list by what the user's mail calls them", () => {
    const { container } = renderEvent({ organizer: "lucas@acme.test" }, { nameForEmail: (email: string) => (email === "lucas@acme.test" ? "Lucas Romero" : undefined) });
    expect(container.querySelector(".message-header .message-sender")!.textContent).toBe("Lucas Romero");
  });
});

const attendee = (email: string, response_status: string | null, extra: Partial<GoogleCalendarEvent["attendees"][number]> = {}) =>
  ({ email, display_name: null, response_status, is_organizer: false, is_self: false, ...extra });

describe("EventView deleting a repeating event", () => {
  const occurrence = { id: "s1_20240110", recurring_event_id: "s1" };

  it("asks which events to delete instead of a second press", () => {
    const props = renderEvent(occurrence);
    fireEvent.click(screen.getByTitle("Delete event"));
    expect(props.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "This and following" }));
    expect(props.onDelete).toHaveBeenCalledWith("following");
  });

  it("asks from the keyboard too, and Escape keeps the event", () => {
    const props = renderEvent(occurrence);
    fireEvent.keyDown(document, { key: "d" });
    const menu = screen.getByRole("menu", { name: "Delete repeating event" });
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Delete repeating event" })).toBeNull();
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(props.container.querySelector(".thread-overlay.closing")).toBeNull();
  });

  it("tells an organizer the guests hear about it", () => {
    renderEvent({ ...occurrence, ...hosting });
    fireEvent.click(screen.getByTitle("Delete event"));
    expect(screen.getByRole("menu", { name: "Delete and notify 2 guests?" })).toBeInTheDocument();
  });
});

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

describe("EventView opening from its row", () => {
  it("grows out of the row it was opened from and shrinks back into it", () => {
    const originalAnimate = Element.prototype.animate;
    const animated: Element[] = [];
    Element.prototype.animate = function (this: Element) {
      animated.push(this);
      return { cancel() {}, finished: Promise.resolve() } as unknown as Animation;
    } as typeof Element.prototype.animate;
    try {
      const row = document.createElement("div");
      row.getBoundingClientRect = () => ({ top: 100, left: 20, right: 320, bottom: 160, width: 300, height: 60, x: 20, y: 100, toJSON() {} }) as DOMRect;
      const props = { ...baseProps(), origin: () => row };
      render(() => <EventView {...props} />);
      const overlay = document.querySelector(".thread-overlay")!;
      expect(overlay).toHaveClass("via-row");
      expect(animated).toContain(overlay);
      animated.length = 0;
      fireEvent.keyDown(document, { key: "Escape" });
      expect(animated).toContain(overlay);
    } finally {
      Element.prototype.animate = originalAnimate;
    }
  });
});
