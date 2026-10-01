import { describe, expect, it } from "vitest";
import type { GoogleCalendarEvent, Thread } from "../api/tauri";
import { guestList, rankEventSuggestions, shortName } from "./eventSuggestions";

const NOW = new Date(2026, 8, 29, 12).getTime();
const HOUR = 1000 * 60 * 60;
const DAY = 24 * HOUR;
const ME = "me@x.com";

const thread = (over: Partial<Thread> = {}): Thread => ({
  gmail_thread_id: "t1", account_id: "a", subject: "Sync next week?", snippet: "",
  last_message_date: NOW - HOUR, unread_count: 0, labels: ["INBOX"],
  participants: ["Ana <ana@y.com>", ME], has_attachment: false, attachments: [], calendar_event: null,
  ...over,
});

const event = (over: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent => ({
  id: "e1", calendar_id: "primary", calendar_name: "Me", title: "Design review", description: null, location: null,
  start_time: NOW - 3 * DAY, end_time: NOW - 3 * DAY + HOUR, all_day: false, status: "confirmed", organizer: ME,
  attendees: [
    { email: ME, display_name: null, response_status: "accepted", is_self: true, is_organizer: true },
    { email: "luis@y.com", display_name: "Luis", response_status: "accepted", is_self: false, is_organizer: false },
  ],
  html_link: null, hangout_link: null, response_status: "accepted", can_edit: true,
  ...over,
});

const rank = (threads: Thread[], events: GoogleCalendarEvent[] = []) => rankEventSuggestions(threads, events, [ME], NOW);

describe("rankEventSuggestions", () => {
  it("suggests a recent thread that asks to meet, named after it, with its people as guests", () => {
    expect(rank([thread({ subject: "Re: Sync next week?" })])).toEqual([{
      kind: "thread", key: "thread:a:t1", summary: "Sync next week?",
      attendees: "Ana <ana@y.com>", names: ["Ana"], at: NOW - HOUR,
    }]);
  });

  it("reads scheduling words in the snippet and in Spanish, as whole words", () => {
    expect(rank([thread({ subject: "Presupuesto", snippet: "¿Podemos juntarnos el jueves?" })])).toHaveLength(1);
    expect(rank([thread({ subject: "Reunión de equipo" })])).toHaveLength(1);
    expect(rank([thread({ subject: "Invoice recalled", snippet: "calls pending" })])).toEqual([]);
  });

  it("leaves out old threads, invites, bulk mail, no-reply senders and big lists", () => {
    expect(rank([thread({ last_message_date: NOW - 8 * DAY })])).toEqual([]);
    expect(rank([thread({ calendar_event: {} as Thread["calendar_event"] })])).toEqual([]);
    expect(rank([thread({ labels: ["INBOX", "CATEGORY_PROMOTIONS"] })])).toEqual([]);
    expect(rank([thread({ participants: ["noreply@y.com", ME] })])).toEqual([]);
    expect(rank([thread({ participants: Array.from({ length: 8 }, (_, i) => `p${i}@y.com`) })])).toEqual([]);
    expect(rank([thread({ participants: [ME] })])).toEqual([]);
  });

  it("leaves out what is already on the calendar", () => {
    const booked = event({ id: "e2", title: "Sync next week?", start_time: NOW + 2 * DAY });
    expect(rank([thread()], [booked])).toEqual([]);
  });

  it("suggests a recent one-off meeting again, with its guests", () => {
    expect(rank([], [event()])).toEqual([{
      kind: "repeat", key: "repeat:design review|luis@y.com", summary: "Design review",
      attendees: "Luis <luis@y.com>", names: ["Luis"], at: NOW - 3 * DAY,
    }]);
  });

  it("does not repeat series, declined, cancelled, all-day, solo or old meetings", () => {
    expect(rank([], [event({ recurring_event_id: "s" })])).toEqual([]);
    expect(rank([], [event({ response_status: "declined" })])).toEqual([]);
    expect(rank([], [event({ status: "cancelled" })])).toEqual([]);
    expect(rank([], [event({ all_day: true })])).toEqual([]);
    expect(rank([], [event({ attendees: [event().attendees[0]] })])).toEqual([]);
    expect(rank([], [event({ start_time: NOW - 15 * DAY })])).toEqual([]);
  });

  it("shows two threads and a meeting before more threads", () => {
    const threads = ["t1", "t2", "t3"].map((id, i) => thread({ gmail_thread_id: id, subject: `Call ${id}`, last_message_date: NOW - (i + 1) * HOUR }));
    expect(rank(threads, [event()]).map(s => s.key)).toEqual(["thread:a:t1", "thread:a:t2", "repeat:design review|luis@y.com"]);
    expect(rank(threads).map(s => s.key)).toEqual(["thread:a:t1", "thread:a:t2", "thread:a:t3"]);
  });
});

describe("guest names in a suggestion", () => {
  it("calls a guest by first name, or by an address's name part when that is all there is", () => {
    expect(shortName("Nami Netti")).toBe("Nami");
    expect(shortName("naminetti@gmail.com")).toBe("naminetti");
  });

  it("names the first two guests and counts the rest", () => {
    expect(guestList(["Ana Ruiz"])).toBe("Ana");
    expect(guestList(["Ana Ruiz", "bo@y.com"])).toBe("Ana, bo");
    expect(guestList(["Ana Ruiz", "bo@y.com", "Cy", "Di"])).toBe("Ana, bo +2");
  });
});
