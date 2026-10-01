import { describe, expect, it } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import type { GoogleCalendarEvent } from "../api/tauri";
import { EventDragGhost, MoveVerdict } from "./EventMove";

const standup = { id: "standup", title: "Standup" } as GoogleCalendarEvent;

describe("MoveVerdict", () => {
  it("says a free time in the free ink, as a status read out when it changes", () => {
    render(() => <MoveVerdict verdict={{ free: true, text: "10:00 is free" }} />);
    const verdict = screen.getByRole("status");
    expect(verdict).toHaveTextContent("10:00 is free");
    expect(verdict).toHaveClass("move-verdict");
    expect(verdict).not.toHaveClass("clash");
  });

  it("marks a clash or a refusal", () => {
    render(() => <MoveVerdict verdict={{ free: false, text: "clashes with Dentist, 09:30" }} />);
    expect(screen.getByRole("status")).toHaveClass("clash");
  });
});

describe("EventDragGhost", () => {
  it("carries the event's title and time under the pointer, hidden from screen readers", () => {
    render(() => <EventDragGhost dragged={{ event: standup, cardId: "cal", x: 40, y: 60, target: null }} time="10:00" />);
    const ghost = document.querySelector<HTMLElement>(".event-drag-ghost")!;
    expect(ghost).toHaveTextContent("Standup10:00");
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    expect(ghost.style.transform).toBe("translate(40px, 60px)");
  });
});
