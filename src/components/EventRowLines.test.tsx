import { describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import { EventRowLines } from "./EventRowLines";
import type { GoogleCalendarEvent } from "../api/tauri";

const event = { id: "e1", title: "Standup", description: "Daily", location: "Room 2", response_status: "accepted" } as GoogleCalendarEvent;

describe("EventRowLines", () => {
  it("says the event's title, time, description, place and the user's answer", () => {
    const { container } = render(() => <EventRowLines event={event} time="9:00" showResponse />);
    expect(container.querySelector(".calendar-event-row")).toHaveTextContent("Standup9:00");
    expect(container.querySelector(".calendar-event-description")).toHaveTextContent("Daily");
    expect(container.querySelector(".calendar-event-location-compact")).toHaveTextContent("Room 2");
    expect(container.querySelector(".calendar-event-response.accepted")).not.toBeNull();
  });

  it("leaves out the answer on an event the user can't answer, and adds the card's own controls", () => {
    const { container } = render(() => <EventRowLines event={event} time="9:00" showResponse={false}><button>Join meeting</button></EventRowLines>);
    expect(container.querySelector(".calendar-event-response")).toBeNull();
    expect(container).toHaveTextContent("Join meeting");
  });
});
