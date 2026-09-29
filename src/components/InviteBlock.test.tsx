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
});
