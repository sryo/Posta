import type { GoogleCalendarEvent, Thread, ThreadGroup } from "../api/tauri";
import type { GroupBy } from "../shared/constants";
import { formatCalendarEventDate } from "../utils";
import { formatDayLabel } from "./dateFormat";

export type CalendarEventGroup = { label: string; events: GoogleCalendarEvent[] };

// Date buckets produced by the backend, newest first
const DATE_GROUP_ORDER = ["Today", "Yesterday", "This week", "Last 30 days", "Older"];

export function getSmartEventTime(event: GoogleCalendarEvent, now: number): string {
  // All-day events: compare dates only, not times
  if (event.all_day) {
    return formatCalendarEventDate(event.start_time, event.end_time, event.all_day);
  }

  const endTime = event.end_time || (event.start_time + 3600000);

  if (now >= event.start_time && now < endTime) {
    return "Now";
  }

  const startsIn = event.start_time - now;
  if (startsIn > 0) {
    const minutes = Math.floor(startsIn / 60000);
    if (minutes < 1) return "Starting";
    if (minutes < 60) return `in ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `in ${hours}h`;
  }

  return formatCalendarEventDate(event.start_time, event.end_time, event.all_day);
}

// All-day timestamps are UTC midnight; place them at local midnight of their
// date, ahead of timed events starting at that same moment
function byStartTime(a: GoogleCalendarEvent, b: GoogleCalendarEvent): number {
  const key = (e: GoogleCalendarEvent) => {
    if (!e.all_day) return e.start_time;
    const d = new Date(e.start_time);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
  };
  return key(a) - key(b) || Number(b.all_day) - Number(a.all_day);
}

export function groupCalendarEvents(events: GoogleCalendarEvent[], groupBy: GroupBy, now: Date = new Date()): CalendarEventGroup[] {
  if (groupBy === "date") {
    const groups: Record<string, GoogleCalendarEvent[]> = {};
    // Each label's actual day, for chronological group ordering (sorting by
    // first event start_time misorders groups once multi-day events repeat)
    const groupDays: Record<string, number> = {};

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Today's name and other days' dates in one locale
    const labelFor = (day: Date) => formatDayLabel(day, now);

    const addToDay = (event: GoogleCalendarEvent, day: Date) => {
      const label = labelFor(day);
      if (!groups[label]) {
        groups[label] = [];
        groupDays[label] = day.getTime();
      }
      groups[label].push(event);
    };

    for (const event of events) {
      // First/last calendar day the event covers (local; UTC components for
      // all-day, whose timestamps are UTC midnight with an exclusive end)
      let firstDay: Date;
      let lastDay: Date;
      if (event.all_day) {
        const s = new Date(event.start_time);
        firstDay = new Date(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
        if (event.end_time) {
          const e = new Date(event.end_time - 86400000);
          lastDay = new Date(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
        } else {
          lastDay = firstDay;
        }
      } else {
        const s = new Date(event.start_time);
        firstDay = new Date(s.getFullYear(), s.getMonth(), s.getDate());
        if (event.end_time && event.end_time > event.start_time) {
          // -1ms so an event ending exactly at midnight stays on its own day
          const e = new Date(event.end_time - 1);
          lastDay = new Date(e.getFullYear(), e.getMonth(), e.getDate());
        } else {
          lastDay = firstDay;
        }
      }
      if (lastDay < firstDay) lastDay = firstDay;

      // Ongoing/multi-day events appear under their start day and every
      // remaining day they span from today on (capped so month-long events
      // don't flood the list)
      addToDay(event, firstDay);
      const horizon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 31);
      const from = firstDay < today
        ? today
        : new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + 1);
      for (let day = from; day <= lastDay && day <= horizon; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
        addToDay(event, day);
      }
    }

    return Object.entries(groups)
      .map(([label, events]) => ({
        label,
        events: events.sort(byStartTime),
      }))
      .sort((a, b) => groupDays[a.label] - groupDays[b.label]);
  }

  if (groupBy === "organizer") {
    return groupByKey(events, e => e.organizer || "Unknown", byStartTime)
      .map(({ label, items }) => ({ label, events: items }));
  }

  if (groupBy === "calendar") {
    return groupByKey(events, e => e.calendar_name || e.calendar_id, byStartTime)
      .map(({ label, items }) => ({ label, events: items }));
  }

  return [{ label: "Events", events }];
}

// Gmail's built-in label ids; everything else (Label_123) is user-created
const SYSTEM_LABEL_IDS = new Set([
  "INBOX", "SENT", "DRAFT", "SPAM", "TRASH", "STARRED", "UNREAD", "IMPORTANT", "CHAT",
  "FORUMS", "UPDATES", "PROMOTIONS", "SOCIAL", "PERSONAL",
]);

export function isUserLabel(labelId: string): boolean {
  return !SYSTEM_LABEL_IDS.has(labelId) && !labelId.startsWith("CATEGORY_");
}

export function regroupThreads(threads: ThreadGroup[], groupBy: GroupBy, labelNames: Record<string, string> = {}): ThreadGroup[] {
  // The backend already groups by date
  if (groupBy === "date") return threads;

  const allThreads = threads.flatMap(g => g.threads);
  const newestFirst = (a: Thread, b: Thread) => b.last_message_date - a.last_message_date;

  if (groupBy === "sender") {
    return groupByKey(allThreads, t => t.participants[0] || "Unknown", newestFirst)
      .map(({ label, items }) => ({ label, threads: items }));
  }

  if (groupBy === "label") {
    const labelOf = (t: Thread) => {
      const userLabel = t.labels.find(isUserLabel);
      if (userLabel) return labelNames[userLabel] || userLabel;
      return t.labels.includes("INBOX") ? "Inbox" : "No label";
    };
    return groupByKey(allThreads, labelOf, newestFirst)
      .map(({ label, items }) => ({ label, threads: items }));
  }

  return threads;
}

// Groups sorted alphabetically by label, items sorted within each group
function groupByKey<T>(items: T[], keyOf: (item: T) => string, compare: (a: T, b: T) => number): { label: string; items: T[] }[] {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyOf(item);
    (groups[key] ??= []).push(item);
  }
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, list]) => ({ label, items: list.sort(compare) }));
}

export function mergeThreadGroups(existing: ThreadGroup[], incoming: ThreadGroup[]): ThreadGroup[] {
  const groups: Record<string, ThreadGroup> = {};
  // Dedupe globally: the same thread must not appear in two date groups.
  // Incoming copies are fresher, so claim their ids first and drop stale
  // copies from the existing groups.
  const seen = new Set<string>();

  for (const group of incoming) {
    const threads = group.threads.filter(t => !seen.has(t.gmail_thread_id));
    threads.forEach(t => seen.add(t.gmail_thread_id));
    groups[group.label] = { ...group, threads };
  }

  for (const group of existing) {
    const threads = group.threads.filter(t => !seen.has(t.gmail_thread_id));
    threads.forEach(t => seen.add(t.gmail_thread_id));
    if (groups[group.label]) {
      // Keep load order within a group: previously loaded pages first
      groups[group.label] = { ...groups[group.label], threads: [...threads, ...groups[group.label].threads] };
    } else {
      groups[group.label] = { ...group, threads };
    }
  }

  // Return in date order, dropping groups emptied by deduplication
  return DATE_GROUP_ORDER.filter(label => groups[label] && groups[label].threads.length > 0).map(label => groups[label]);
}
