import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { InviteBlock } from "./InviteBlock";
import type { CalendarEvent } from "../api/tauri";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const invite: CalendarEvent = {
  uid: "ev-1@google.com",
  title: "Design review",
  start_time: Date.UTC(2030, 0, 1, 15),
  end_time: Date.UTC(2030, 0, 1, 16),
  all_day: false,
  location: "Studio 2",
  description: null,
  organizer: "jules@x.test",
  attendees: [],
  method: "REQUEST",
  status: null,
  response_status: null,
  conference_url: "https://meet.google.com/abc",
};

describe("InviteBlock", () => {
  it("shows the title, time and place of the invite when asked for the title", () => {
    const { container } = render(() => <InviteBlock invite={invite} showTitle rsvp={undefined} onAnswer={vi.fn()} />);
    expect(screen.getByText("Design review")).toBeInTheDocument();
    expect(screen.getByText("Studio 2")).toBeInTheDocument();
    expect(container.querySelector(".calendar-event-time")).not.toBeNull();
  });

  it("leaves the title out on a card row, where the subject already says it", () => {
    render(() => <InviteBlock invite={invite} rsvp={undefined} onAnswer={vi.fn()} />);
    expect(screen.queryByText("Design review")).toBeNull();
  });

  it("joins the video call without opening the email", async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    const onRowClick = vi.fn();
    render(() => <div onClick={onRowClick}><InviteBlock invite={invite} rsvp={undefined} onAnswer={vi.fn()} /></div>);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(openUrl).toHaveBeenCalledWith("https://meet.google.com/abc");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("answers the invite with the shared RSVP control", () => {
    const onAnswer = vi.fn();
    render(() => <InviteBlock invite={invite} rsvp="accepted" onAnswer={onAnswer} size="md" />);
    expect(screen.getByRole("button", { name: "Going" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Not going" }));
    expect(onAnswer).toHaveBeenCalledWith("declined");
  });

  it("offers no answer for a cancellation or an invite without a UID", () => {
    const { unmount } = render(() => <InviteBlock invite={{ ...invite, method: "CANCEL" }} rsvp={undefined} onAnswer={vi.fn()} />);
    expect(screen.queryByRole("group", { name: "Your response" })).toBeNull();
    unmount();
    render(() => <InviteBlock invite={{ ...invite, uid: null }} rsvp={undefined} onAnswer={vi.fn()} />);
    expect(screen.queryByRole("group", { name: "Your response" })).toBeNull();
  });

  it("offers no Join without a call link", () => {
    render(() => <InviteBlock invite={{ ...invite, conference_url: null }} rsvp={undefined} onAnswer={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Join" })).toBeNull();
  });

  it("leaves out a location that is only the call Join opens, and keeps a real place", () => {
    const { container, unmount } = render(() => <InviteBlock invite={{ ...invite, location: "https://meet.google.com/abc" }} rsvp={undefined} onAnswer={vi.fn()} />);
    expect(container.querySelector(".calendar-event-location")).toBeNull();
    unmount();
    render(() => <InviteBlock invite={{ ...invite, location: "https://meet.google.com/abc", conference_url: null }} rsvp={undefined} onAnswer={vi.fn()} />);
    expect(screen.getByText("https://meet.google.com/abc")).toBeInTheDocument();
  });

  it("draws the day strip it is given, with hour labels and what the invite clashes with", () => {
    const strip = {
      window: { start: new Date(2030, 0, 1, 8).getTime(), end: new Date(2030, 0, 1, 20).getTime() },
      slot: { left: 50, width: 10 },
      busy: [{ left: 55, width: 10, title: "Dentist", overlap: true }, { left: 80, width: 5, title: "Gym", overlap: false }],
      clashes: [{ start: 0, end: 1, title: "Dentist" }, { start: 0, end: 1, title: "Lunch" }],
      noonAt: 33.3, nowAt: null, past: null,
    };
    const { container } = render(() => <InviteBlock invite={invite} rsvp="accepted" onAnswer={vi.fn()} strip={strip} />);
    expect(container.querySelectorAll(".day-strip-busy")).toHaveLength(2);
    expect(container.querySelector(".day-strip-hours")?.children).toHaveLength(5);
    expect(container.querySelector(".invite-block-clash")).toHaveTextContent("Clashes with Dentist and 1 more");
  });
});
