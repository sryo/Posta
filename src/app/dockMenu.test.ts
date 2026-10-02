import { describe, expect, it } from "vitest";
import type { GoogleCalendarEvent } from "../api/tauri";
import { dockMenu } from "./dockMenu";

const at = (h: number, m: number, day = 1) => new Date(2026, 9, day, h, m).getTime();
const event = (title: string, start: number, extra: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent => ({
  id: title, calendar_id: "c", calendar_name: "Work", title, description: null, location: null,
  start_time: start, end_time: start + 30 * 60_000, all_day: false, status: "confirmed", organizer: null, attendees: [],
  html_link: null, hangout_link: null, response_status: "accepted", can_edit: true, ...extra,
});
const mail = (id: string, name: string) => ({ id, name, card_type: "email" as const });
const calendar = (id: string, name: string) => ({ id, name, card_type: "calendar" as const });

describe("dockMenu", () => {
  it("lists the cards in board order, each with its unread count when it has any", () => {
    const menu = dockMenu([mail("i", "Inbox"), mail("r", "Receipts")], { i: 7 }, [], at(9, 0), "en-GB");
    expect(menu.cards).toEqual([{ id: "i", title: "Inbox (7)" }, { id: "r", title: "Receipts" }]);
  });

  it("says nothing about events on a board without a calendar card", () => {
    expect(dockMenu([mail("i", "Inbox")], {}, [], at(9, 0), "en-GB").next).toBeNull();
  });

  it("names the next event, when it starts and how long until then", () => {
    const cards = [mail("i", "Inbox"), calendar("t", "Today")];
    const events = [event("Standup", at(9, 0)), event("Design review", at(14, 30))];
    expect(dockMenu(cards, {}, events, at(14, 8), "en-GB").next).toBe("Next: Design review, 14:30 · in 22 min");
    expect(dockMenu(cards, {}, events, at(9, 0), "en-US").next).toBe("Next: Design review, 2:30 PM · in 5 h 30 min");
    expect(dockMenu(cards, {}, events, at(12, 30), "en-GB").next).toBe("Next: Design review, 14:30 · in 2 h");
  });

  it("says nothing else is on once today's events have started", () => {
    const cards = [calendar("t", "Today")];
    const events = [event("Design review", at(14, 30)), event("Tomorrow's standup", at(9, 0, 2))];
    expect(dockMenu(cards, {}, events, at(14, 31), "en-GB").next).toBe("Nothing else today");
    expect(dockMenu(cards, {}, [], at(14, 31), "en-GB").next).toBe("Nothing else today");
  });
});
