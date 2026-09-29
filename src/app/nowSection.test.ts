import { describe, expect, it } from "vitest";
import type { CalendarEvent, Thread } from "../api/tauri";
import { isHappeningNow, joinLabel, meetingProgress, withNowSection } from "./nowSection";

const at = (hour: number, minute = 0) => new Date(2026, 8, 29, hour, minute).getTime();

const invite = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  uid: "standup@google.com", title: "Daily standup", start_time: at(10), end_time: at(10, 15), all_day: false,
  location: null, description: null, organizer: null, attendees: [], method: "REQUEST", status: null,
  response_status: null, conference_url: "https://meet.google.com/abc", ...over,
});

const thread = (id: string, calendar_event: CalendarEvent | null = null): Thread => ({
  gmail_thread_id: id, account_id: "a", subject: id, snippet: "", last_message_date: 0, unread_count: 0,
  labels: [], participants: [], has_attachment: false, attachments: [], calendar_event,
});

describe("isHappeningNow", () => {
  it("holds from ten minutes before the start until the end", () => {
    expect(isHappeningNow(invite(), undefined, at(9, 49))).toBe(false);
    expect(isHappeningNow(invite(), undefined, at(9, 50))).toBe(true);
    expect(isHappeningNow(invite(), undefined, at(10, 5))).toBe(true);
    expect(isHappeningNow(invite(), undefined, at(10, 15))).toBe(false);
  });

  it("gives an invite without an end half an hour", () => {
    expect(isHappeningNow(invite({ end_time: null }), undefined, at(10, 29))).toBe(true);
    expect(isHappeningNow(invite({ end_time: null }), undefined, at(10, 30))).toBe(false);
  });

  it("leaves out all-day events, cancellations, declined meetings and mail that is not an invite", () => {
    expect(isHappeningNow(invite({ all_day: true }), undefined, at(10, 5))).toBe(false);
    expect(isHappeningNow(invite({ method: "CANCEL" }), undefined, at(10, 5))).toBe(false);
    expect(isHappeningNow(invite({ status: "CANCELLED" }), undefined, at(10, 5))).toBe(false);
    expect(isHappeningNow(invite(), "declined", at(10, 5))).toBe(false);
    expect(isHappeningNow(invite({ method: "REPLY" }), undefined, at(10, 5))).toBe(false);
    expect(isHappeningNow(null, undefined, at(10, 5))).toBe(false);
  });
});

describe("withNowSection", () => {
  const live = thread("live", invite());
  const later = thread("later", invite({ start_time: at(15), end_time: at(16) }));
  const mail = thread("mail");
  const isNow = (t: Thread) => isHappeningNow(t.calendar_event, undefined, at(10, 5));

  it("pulls meetings happening now into a section above the others", () => {
    const groups = [{ label: "Today", threads: [mail, live] }, { label: "Yesterday", threads: [later] }];
    expect(withNowSection(groups, isNow)).toEqual([
      { label: "Now", threads: [live], now: true },
      { label: "Today", threads: [mail] },
      { label: "Yesterday", threads: [later] },
    ]);
  });

  it("drops a group the section emptied", () => {
    const groups = [{ label: "Today", threads: [live] }, { label: "Yesterday", threads: [mail] }];
    expect(withNowSection(groups, isNow).map(g => g.label)).toEqual(["Now", "Yesterday"]);
  });

  it("leaves the groups alone when nothing is happening", () => {
    const groups = [{ label: "Today", threads: [mail, later] }];
    expect(withNowSection(groups, isNow)).toBe(groups);
  });
});

describe("meetingProgress", () => {
  it("counts the minutes gone of the meeting", () => {
    expect(meetingProgress(invite(), at(10, 2))).toEqual({ started: true, elapsed: 2, total: 15, percent: (2 / 15) * 100, text: "2 of 15 minutes" });
  });

  it("says how soon a meeting that has not started begins", () => {
    expect(meetingProgress(invite(), at(9, 56))).toEqual({ started: false, elapsed: 0, total: 15, percent: 0, text: "Starts in 4 minutes" });
    expect(meetingProgress(invite(), at(9, 59) + 30_000).text).toBe("Starts in 1 minute");
  });
});

describe("joinLabel", () => {
  it("names the service the button opens", () => {
    expect(joinLabel("https://meet.google.com/abc")).toBe("Join Google Meet");
    expect(joinLabel("https://zoom.us/j/1")).toBe("Join Zoom");
    expect(joinLabel("https://call.example.com/x")).toBe("Join call.example.com");
  });
});
