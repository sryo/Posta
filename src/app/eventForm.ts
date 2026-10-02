import type { GoogleCalendarEvent } from "../api/tauri";
import { extractEmail, splitEmailList, toDateInputString } from "../utils";

export interface EventFormTimes {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// Round up to the next 30-minute mark, lasting 30 minutes
export function smartEventDefaults(now: Date = new Date()) {
  const startTime = new Date(now);
  if (now.getMinutes() <= 30) {
    startTime.setMinutes(30, 0, 0);
  } else {
    startTime.setHours(startTime.getHours() + 1, 0, 0, 0);
  }
  const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
  // Dates come from the times themselves, so rounding or lasting past midnight advances the day
  return { date: toDateInputString(startTime), startTime: hhmm(startTime), endDate: toDateInputString(endTime), endTime: hhmm(endTime) };
}

// All-day dates are anchored at UTC noon: the backend formats the UTC date,
// and noon keeps it on the chosen day. The all-day end date is inclusive.
function utcNoon(date: string): number {
  const [y, m, d] = date.split('-').map(n => parseInt(n, 10));
  return Date.UTC(y, m - 1, d, 12, 0, 0);
}

export function eventTimesFromForm(form: EventFormTimes): { start: number; end: number } | { error: string } {
  const start = form.allDay ? utcNoon(form.startDate) : new Date(`${form.startDate}T${form.startTime}`).getTime();
  const end = form.allDay ? utcNoon(form.endDate) : new Date(`${form.endDate}T${form.endTime}`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: "Enter a valid start and end" };
  if (end < start) return { error: "End must be after start" };
  return { start, end };
}

// A new event about an email thread: named after its subject, with its
// participants other than the user as guests
export function eventFromThread(subject: string, participants: string[], accountEmail: string): { summary: string; attendees: string } {
  const summary = subject.replace(/^(\s*(re|fwd?)\s*:\s*)+/i, "").trim();
  const seen = new Set([accountEmail.toLowerCase()]);
  const guests: string[] = [];
  for (const participant of participants) {
    const email = extractEmail(participant).trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    guests.push(participant.trim());
  }
  return { summary, attendees: guests.join(", ") };
}

// Guest addresses typed as a comma-separated list, with or without names
export function eventAttendees(text: string): string[] {
  return splitEmailList(text).map(extractEmail).filter(e => e.trim());
}

// The event form filled with an event to change it in place
export function editFormFor(event: GoogleCalendarEvent, accountId: string, now: Date = new Date()) {
  const startDate = new Date(event.start_time);
  let endDate = event.end_time ? new Date(event.end_time) : startDate;
  // All-day end_time is Google's exclusive end (day after the last day); the
  // form's endDate is inclusive, so step back one day
  if (event.all_day && event.end_time) endDate = new Date(endDate.getTime() - 86400000);
  // All-day timestamps are UTC-anchored; their local rendering is a time the
  // user never chose (e.g. 17:00 in UTC-7), which would be saved verbatim if
  // "All day" gets unchecked. Prefill smart defaults instead.
  const timeDefaults = smartEventDefaults(now);
  return {
    summary: event.title || '',
    description: event.description || '',
    location: event.location || '',
    startDate: toDateInputString(startDate, event.all_day),
    startTime: event.all_day ? timeDefaults.startTime : hhmm(startDate),
    endDate: toDateInputString(endDate, event.all_day),
    endTime: event.all_day ? timeDefaults.endTime : hhmm(endDate),
    allDay: event.all_day,
    attendees: event.attendees.map(a => a.email).join(', '),
    // Cards list single occurrences; a null rule leaves a series' recurrence alone
    recurrence: null,
    addMeet: false,
    editing: { id: event.id, calendarId: event.calendar_id, accountId },
  };
}
