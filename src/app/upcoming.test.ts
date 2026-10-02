import { describe, expect, it } from "vitest";
import type { GoogleCalendarEvent } from "../api/tauri";
import { timedEvents } from "./upcoming";

const event = (id: string, start: number, extra: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent => ({
  id, calendar_id: "c", calendar_name: "Work", title: id, description: null, location: null,
  start_time: start, end_time: start + 1000, all_day: false, status: "confirmed", organizer: null, attendees: [],
  html_link: null, hangout_link: null, response_status: "accepted", can_edit: true, ...extra,
});

describe("timedEvents", () => {
  it("lists an event two calendar cards both show once, by start time", () => {
    const standup = event("standup", 2000);
    expect(timedEvents([standup, event("review", 1000), standup]).map(e => e.id)).toEqual(["review", "standup"]);
  });
});
