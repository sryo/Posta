import { describe, expect, it, vi } from "vitest";
import type { GoogleCalendarEvent, Thread, ThreadGroup } from "../api/tauri";
import { getSmartEventTime, groupCalendarEvents, mergeThreadGroups, regroupThreads } from "./grouping";
import { appLocale, formatDayLabel } from "./dateFormat";

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

  it("names sender groups after the sender, keeping one group per address", () => {
    const groups = [{ label: "Today", threads: [
      thread("a", { participants: ["Ana Pérez <ana@x>"], last_message_date: 2 }),
      thread("b", { participants: ["ana@x"], last_message_date: 1 }),
      thread("c", { participants: ["Ana Pérez <other@x>"], last_message_date: 3 }),
    ] }];
    expect(ids(regroupThreads(groups, "sender"))).toEqual([["Ana Pérez", ["a", "b"]], ["Ana Pérez", ["c"]]]);
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

  it("names each thread's label in its own mailbox, where label ids can repeat", () => {
    const groups = [{ label: "Today", threads: [
      thread("a", { labels: ["Label_1"], account_id: "home" }),
      thread("b", { labels: ["Label_1"], account_id: "work" }),
    ] }];
    const names: Record<string, Record<string, string>> = { home: { Label_1: "Family" }, work: { Label_1: "Clients" } };
    const nameOf = (t: { account_id: string }, id: string) => names[t.account_id]?.[id];
    expect(ids(regroupThreads(groups, "label", nameOf))).toEqual([["Clients", ["b"]], ["Family", ["a"]]]);
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

  it("gives each day's group the midnight it stands for, and other groups none", () => {
    const events = [
      event("today", { start_time: at(11, 15), end_time: at(11, 16) }),
      event("later", { start_time: at(13, 10), end_time: at(13, 11) }),
    ];
    expect(groupCalendarEvents(events, "date", now).map(g => g.day)).toEqual([new Date(2026, 2, 11).getTime(), new Date(2026, 2, 13).getTime()]);
    expect(groupCalendarEvents(events, "calendar", now).map(g => g.day)).toEqual([undefined]);
  });

  it("names the days in the app's locale, the language of the rest of its copy", () => {
    const language = vi.spyOn(navigator, "language", "get").mockReturnValue("es-AR");
    try {
      const groups = groupCalendarEvents([
        event("today", { start_time: at(11, 15), end_time: at(11, 16) }),
        event("later", { start_time: at(13, 10), end_time: at(13, 11) }),
      ], "date", now);
      expect(groups[0].label).toBe("Today");
      expect(groups[1].label).toBe(formatDayLabel(new Date(2026, 2, 13), now, appLocale("es-AR")));
    } finally {
      language.mockRestore();
    }
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

  it("names organizer groups from the guest list", () => {
    const guest = { email: "zed@x", display_name: "Zed Alvarez", response_status: null, is_self: false, is_organizer: true };
    const events = [event("1", { organizer: "zed@x", attendees: [guest] }), event("2", { organizer: "zed@x" })];
    expect(groupCalendarEvents(events, "organizer").map(g => [g.label, g.events.map(e => e.id)]))
      .toEqual([["Zed Alvarez", ["1", "2"]]]);
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
