import { describe, expect, it } from "vitest";
import type { GoogleCalendarEvent, Thread, ThreadGroup } from "../api/tauri";
import { getSmartEventTime, groupCalendarEvents, mergeThreadGroups, regroupThreads } from "./grouping";

function thread(id: string, over: Partial<Thread> = {}): Thread {
  return {
    gmail_thread_id: id,
    account_id: "acc",
    subject: id,
    snippet: "",
    last_message_date: 0,
    unread_count: 0,
    labels: [],
    participants: [],
    has_attachment: false,
    attachments: [],
    calendar_event: null,
    ...over,
  };
}

function event(id: string, over: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent {
  return {
    id,
    calendar_id: "primary",
    calendar_name: "Me",
    title: id,
    description: null,
    location: null,
    start_time: 0,
    end_time: null,
    all_day: false,
    status: "confirmed",
    organizer: null,
    attendees: [],
    html_link: null,
    hangout_link: null,
    response_status: null,
    can_edit: true,
    ...over,
  };
}

const ids = (groups: ThreadGroup[]) => groups.map(g => [g.label, g.threads.map(t => t.gmail_thread_id)]);

describe("regroupThreads", () => {
  it("leaves backend date groups alone", () => {
    const groups = [{ label: "Today", threads: [thread("a")] }];
    expect(regroupThreads(groups, "date")).toBe(groups);
  });

  it("groups by sender, newest first inside each group", () => {
    const groups = [
      { label: "Today", threads: [thread("a", { participants: ["bo@x"], last_message_date: 1 })] },
      { label: "Older", threads: [
        thread("b", { participants: ["al@x"], last_message_date: 5 }),
        thread("c", { participants: ["bo@x"], last_message_date: 9 }),
      ] },
    ];
    expect(ids(regroupThreads(groups, "sender"))).toEqual([["al@x", ["b"]], ["bo@x", ["c", "a"]]]);
  });

  it("groups by label using label names and skipping system labels", () => {
    const groups = [{ label: "Today", threads: [
      thread("a", { labels: ["IMPORTANT", "INBOX", "Label_7"] }),
      thread("b", { labels: ["SENT", "CATEGORY_UPDATES"] }),
      thread("c", { labels: ["INBOX", "UNREAD"] }),
    ] }];
    const names = { Label_7: "Clients" };
    expect(ids(regroupThreads(groups, "label", names))).toEqual([
      ["Clients", ["a"]],
      ["Inbox", ["c"]],
      ["No label", ["b"]],
    ]);
  });

  it("falls back to the label id when its name is unknown", () => {
    const groups = [{ label: "Today", threads: [thread("a", { labels: ["Label_9"] })] }];
    expect(ids(regroupThreads(groups, "label", {}))).toEqual([["Label_9", ["a"]]]);
  });
});

describe("mergeThreadGroups", () => {
  it("appends the next page and keeps date order", () => {
    const existing = [{ label: "Today", threads: [thread("a")] }];
    const incoming = [
      { label: "Older", threads: [thread("c")] },
      { label: "Today", threads: [thread("b")] },
    ];
    expect(ids(mergeThreadGroups(existing, incoming))).toEqual([["Today", ["a", "b"]], ["Older", ["c"]]]);
  });

  it("keeps a thread once, preferring the incoming copy", () => {
    const existing = [{ label: "Today", threads: [thread("a", { subject: "old" }), thread("b")] }];
    const incoming = [{ label: "Yesterday", threads: [thread("a", { subject: "new" })] }];
    const merged = mergeThreadGroups(existing, incoming);
    expect(ids(merged)).toEqual([["Today", ["b"]], ["Yesterday", ["a"]]]);
    expect(merged[1].threads[0].subject).toBe("new");
  });
});

describe("groupCalendarEvents", () => {
  // Wednesday 2026-03-11 09:00 local
  const now = new Date(2026, 2, 11, 9, 0);
  const at = (d: number, h: number) => new Date(2026, 2, d, h).getTime();
  const allDay = (d: number) => Date.UTC(2026, 2, d);

  it("labels today and tomorrow and orders groups chronologically", () => {
    const groups = groupCalendarEvents([
      event("tomorrow", { start_time: at(12, 10), end_time: at(12, 11) }),
      event("today-late", { start_time: at(11, 15), end_time: at(11, 16) }),
      event("today-early", { start_time: at(11, 8), end_time: at(11, 9) }),
    ], "date", now);
    expect(groups.map(g => [g.label, g.events.map(e => e.id)])).toEqual([
      ["Today", ["today-early", "today-late"]],
      ["Tomorrow", ["tomorrow"]],
    ]);
  });

  it("puts a one-day all-day event on its own date only", () => {
    const groups = groupCalendarEvents([event("holiday", { all_day: true, start_time: allDay(12), end_time: allDay(13) })], "date", now);
    expect(groups.map(g => g.label)).toEqual(["Tomorrow"]);
  });

  it("repeats a multi-day event under each remaining day it spans", () => {
    const groups = groupCalendarEvents([event("trip", { all_day: true, start_time: allDay(10), end_time: allDay(13) })], "date", now);
    expect(groups.map(g => g.label)).toEqual(["Yesterday", "Today", "Tomorrow"]);
  });

  it("keeps an event ending exactly at midnight on its own day", () => {
    const groups = groupCalendarEvents([event("late", { start_time: at(11, 22), end_time: at(12, 0) })], "date", now);
    expect(groups.map(g => g.label)).toEqual(["Today"]);
  });

  it("groups by organizer and by calendar alphabetically", () => {
    const events = [
      event("1", { organizer: "zed@x", calendar_name: "Work", start_time: 2 }),
      event("2", { organizer: null, calendar_name: "Home", start_time: 1 }),
      event("3", { organizer: "zed@x", calendar_name: "Work", start_time: 1 }),
    ];
    expect(groupCalendarEvents(events, "organizer").map(g => [g.label, g.events.map(e => e.id)]))
      .toEqual([["Unknown", ["2"]], ["zed@x", ["3", "1"]]]);
    expect(groupCalendarEvents(events, "calendar").map(g => g.label)).toEqual(["Home", "Work"]);
  });

  it("sorts an all-day event from its local midnight, ahead of meetings starting then", () => {
    const events = [
      event("midnight", { start_time: at(12, 0) }),
      event("late", { start_time: new Date(2026, 2, 11, 23, 30).getTime() }),
      event("holiday", { all_day: true, start_time: allDay(12), end_time: allDay(13) }),
    ];
    for (const groupBy of ["organizer", "calendar"] as const) {
      expect(groupCalendarEvents(events, groupBy)[0].events.map(e => e.id)).toEqual(["late", "holiday", "midnight"]);
    }
  });
});

describe("getSmartEventTime", () => {
  const start = new Date(2026, 2, 11, 10, 0).getTime();
  const ev = event("e", { start_time: start, end_time: start + 30 * 60000 });

  it("counts down relative to the given time", () => {
    expect(getSmartEventTime(ev, start - 90 * 60000)).toBe("in 1h");
    expect(getSmartEventTime(ev, start - 5 * 60000)).toBe("in 5 min");
    expect(getSmartEventTime(ev, start - 30000)).toBe("Starting");
    expect(getSmartEventTime(ev, start + 60000)).toBe("Now");
  });

  it("treats an event without an end as one hour long", () => {
    const open = event("o", { start_time: start, end_time: null });
    expect(getSmartEventTime(open, start + 59 * 60000)).toBe("Now");
    expect(getSmartEventTime(open, start + 61 * 60000)).not.toBe("Now");
  });
});
