import type { GoogleCalendarEvent, Thread } from "../api/tauri";
import { extractEmail } from "../utils";
import { personName } from "./people";

// An event the user may want next: one a mail thread is arranging, or a
// meeting held recently that isn't on the calendar again
export interface EventSuggestion {
  kind: "thread" | "repeat";
  key: string;
  summary: string;
  // Comma-separated, as the event form's guest field takes them
  attendees: string;
  // The guests' names, for the label
  names: string[];
  // When the thread last moved, or when the meeting was held
  at: number;
}

const DAY_MS = 1000 * 60 * 60 * 24;
const THREAD_WINDOW_MS = 7 * DAY_MS;
const REPEAT_WINDOW_MS = 14 * DAY_MS;
const UPCOMING_WINDOW_MS = 14 * DAY_MS;
const MAX_GUESTS = 7;
const MAX_THREADS = 2;
const MAX_SHOWN = 3;

// Words that ask for a time together, in English and Spanish. \b is ASCII-only
// in JS, so letters on either side are ruled out with lookarounds instead
const SCHEDULING = new RegExp(
  "(?<!\\p{L})(" + [
    "meet(ing)?", "sync", "call", "catch up", "chat", "schedule", "availability", "available",
    "next week", "tomorrow", "coffee", "lunch", "1:1", "1on1", "when works", "what time",
    "reuni[oó]n", "llamada", "juntarnos", "coordinar", "agendar", "disponib\\p{L}*",
    "pr[oó]xima semana", "semana que viene", "caf[eé]", "almuerzo",
  ].join("|") + ")(?!\\p{L})",
  "iu",
);

const NO_REPLY = /^(no|do[-_.]?not)[-_.]?reply\b/i;
const BULK_LABELS = new Set(["SPAM", "TRASH", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"]);

const stripPrefixes = (subject: string) => subject.replace(/^(\s*(re|fwd?|rv|reenv)\s*:\s*)+/i, "").trim();
const sameTitle = (title: string) => stripPrefixes(title).toLowerCase();

// Threads and one-off meetings of the last days, best first: at most two
// threads, then a meeting, then more of either to fill three. Anything already
// on the calendar in the next two weeks is left out
export function rankEventSuggestions(
  threads: readonly Thread[],
  events: readonly GoogleCalendarEvent[],
  ownEmails: readonly string[],
  now: number,
): EventSuggestion[] {
  const own = new Set(ownEmails.map(e => e.toLowerCase()));
  const upcoming = new Set(events
    .filter(e => e.status !== "cancelled" && e.start_time >= now && e.start_time < now + UPCOMING_WINDOW_MS)
    .map(e => sameTitle(e.title)));

  const fromThreads = threadSuggestions(threads, own, upcoming, now);
  const repeats = repeatSuggestions(events, own, upcoming, now);
  const picked = [...fromThreads.slice(0, MAX_THREADS), ...repeats.slice(0, 1)];
  const rest = [...fromThreads.slice(MAX_THREADS), ...repeats.slice(1)].sort((a, b) => b.score - a.score);
  return [...picked, ...rest].slice(0, MAX_SHOWN).map(s => s.suggestion);
}

interface Scored { suggestion: EventSuggestion; score: number }

function threadSuggestions(threads: readonly Thread[], own: Set<string>, upcoming: Set<string>, now: number): Scored[] {
  const seen = new Set<string>();
  const scored: Scored[] = [];
  for (const thread of threads) {
    const key = `thread:${thread.account_id}:${thread.gmail_thread_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const age = now - thread.last_message_date;
    if (age < 0 || age > THREAD_WINDOW_MS) continue;
    if (thread.calendar_event) continue;
    if (thread.labels.some(l => BULK_LABELS.has(l))) continue;

    const summary = stripPrefixes(thread.subject);
    if (!summary || upcoming.has(summary.toLowerCase())) continue;
    if (!SCHEDULING.test(`${thread.subject} ${thread.snippet}`)) continue;

    const guests = otherPeople(thread.participants, own);
    if (guests.length === 0 || guests.length > MAX_GUESTS) continue;
    if (guests.some(g => NO_REPLY.test(extractEmail(g)))) continue;

    scored.push({
      suggestion: {
        kind: "thread", key, summary,
        attendees: guests.join(", "),
        names: guests.map(personName),
        at: thread.last_message_date,
      },
      score: 3 + (thread.unread_count > 0 ? 1 : 0) + (1 - age / THREAD_WINDOW_MS),
    });
  }
  return scored.sort((a, b) => b.score - a.score);
}

function repeatSuggestions(events: readonly GoogleCalendarEvent[], own: Set<string>, upcoming: Set<string>, now: number): Scored[] {
  const seen = new Set<string>();
  const groups = new Map<string, { event: GoogleCalendarEvent; guests: GoogleCalendarEvent["attendees"]; count: number }>();
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const age = now - event.start_time;
    if (age <= 0 || age > REPEAT_WINDOW_MS) continue;
    if (event.all_day || event.recurring_event_id || event.status === "cancelled" || event.response_status === "declined") continue;
    if (!event.title.trim() || upcoming.has(sameTitle(event.title))) continue;

    const guests = event.attendees.filter(a => !a.is_self && !own.has(a.email.toLowerCase()) && !a.email.endsWith("resource.calendar.google.com"));
    if (guests.length === 0 || guests.length > MAX_GUESTS) continue;

    const key = `${sameTitle(event.title)}|${guests.map(g => g.email.toLowerCase()).sort().join(",")}`;
    const group = groups.get(key);
    if (!group) groups.set(key, { event, guests, count: 1 });
    else {
      group.count++;
      if (event.start_time > group.event.start_time) group.event = event;
    }
  }
  return Array.from(groups.entries(), ([key, { event, guests, count }]) => ({
    suggestion: {
      kind: "repeat" as const,
      key: `repeat:${key}`,
      summary: event.title.trim(),
      attendees: guests.map(g => g.display_name ? `${g.display_name} <${g.email}>` : g.email).join(", "),
      names: guests.map(g => g.display_name || g.email),
      at: event.start_time,
    },
    score: count + (1 - (now - event.start_time) / REPEAT_WINDOW_MS),
  })).sort((a, b) => b.score - a.score);
}

// A thread's participants other than the user, once each
function otherPeople(participants: readonly string[], own: Set<string>): string[] {
  const seen = new Set(own);
  const people: string[] = [];
  for (const participant of participants) {
    const email = extractEmail(participant).trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    people.push(participant.trim());
  }
  return people;
}

// A guest as a suggestion row names them: a first name, or the part of a
// bare address before the @
export function shortName(nameOrEmail: string): string {
  const name = nameOrEmail.trim();
  return name.includes("@") ? name.split("@")[0] : name.split(/\s+/)[0];
}

// The first two guests by short name, and how many more
export function guestList(names: readonly string[]): string {
  const shown = names.slice(0, 2).map(shortName).join(", ");
  return names.length > 2 ? `${shown} +${names.length - 2}` : shown;
}
