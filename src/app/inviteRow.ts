import type { CalendarEvent } from "../api/tauri";
import { capitalise, dayOffset, formatClock, localeOrApp, relativeDayName, uses12HourClock } from "./dateFormat";
import { isRsvpAnswer, type RsvpStatus } from "./rsvp";

// What an invite email's card row shows in place of a mail row's time and
// snippet: when the event is, how long, where, and the user's answer

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

type Timing = Pick<CalendarEvent, "start_time" | "end_time" | "all_day">;

// An all-day event's timestamps are UTC midnight of its dates; this is the
// same date at local midnight
function localDate(utcMidnight: number): Date {
  const d = new Date(utcMidnight);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function inviteStart(invite: Timing): number {
  return invite.all_day ? localDate(invite.start_time).getTime() : invite.start_time;
}

// When the event is over: an all-day event at local midnight after its last
// day, an invite without an end at its start
export function inviteEnd(invite: Timing): number {
  if (!invite.all_day) return invite.end_time ?? invite.start_time;
  if (invite.end_time) return localDate(invite.end_time).getTime();
  const start = localDate(invite.start_time);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime();
}

// "Tomorrow 3:00 PM", "Fri, Oct 2, 1:00 PM"; an all-day event's day alone
export function inviteWhen(invite: Timing, now: Date, locale?: string): string {
  const start = new Date(inviteStart(invite));
  const relative = relativeDayName(start, now, locale);
  const clock = invite.all_day ? null : formatClock(start, locale);
  if (relative && Math.abs(dayOffset(start, now)) <= 1) return clock ? `${relative} ${clock}` : relative;
  const text = new Intl.DateTimeFormat(localeOrApp(locale), {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(start.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
    ...(clock ? { hour: uses12HourClock(locale) ? "numeric" as const : "2-digit" as const, minute: "2-digit" as const } : {}),
  }).format(start);
  return capitalise(text, locale);
}

// "30 min", "1 hr", "1 hr 30 min", "1 day 2 hr"
export function formatDuration(minutes: number): string {
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const mins = minutes % 60;
  const parts = [days && `${days} ${days === 1 ? "day" : "days"}`, hours && `${hours} hr`, mins && `${mins} min`].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "0 min";
}

// What Google wraps an invite's title in, in English and Spanish: "Invitation:",
// "Accepted:" and the like before it, and " @ <when> (<zone>) (<address>)"
// after it. The row shows the time on its own, so only the title is left.
const INVITE_PREFIX = /^\s*(updated invitation|invitation|accepted|declined|tentatively accepted|canceled event|cancelled event|invitación actualizada|invitación|aceptado|aceptada|rechazado|rechazada|aceptado provisionalmente|evento cancelado)(\s+with note|\s+con nota)?\s*:\s*/i;
const INVITE_SUFFIX = /\s+@\s+.*\((?:GMT|UTC)[^)]*\).*$/i;

export function inviteTitle(subject: string): string {
  const title = subject.replace(INVITE_PREFIX, "").replace(INVITE_SUFFIX, "").trim();
  return title || subject;
}

export function inviteDuration(invite: Timing): string | null {
  if (invite.all_day) {
    const days = Math.max(1, Math.round((inviteEnd(invite) - inviteStart(invite)) / DAY_MS));
    return days === 1 ? "All day" : `${days} days`;
  }
  if (!invite.end_time) return null;
  return formatDuration(Math.max(0, Math.round((invite.end_time - invite.start_time) / MINUTE_MS)));
}

const CALL_HOSTS: [RegExp, string][] = [
  [/(^|\.)meet\.google\.com$/, "Google Meet"],
  [/(^|\.)zoom\.us$/, "Zoom"],
  [/(^|\.)teams\.(microsoft|live)\.com$/, "Microsoft Teams"],
  [/(^|\.)webex\.com$/, "Webex"],
];

function callHost(text: string): string | null {
  if (!/^https?:\/\//i.test(text.trim())) return null;
  try {
    return new URL(text.trim()).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// The name of the service a call link opens: "Google Meet", else its host
export function callName(url: string): string {
  const host = callHost(url) ?? url;
  return CALL_HOSTS.find(([pattern]) => pattern.test(host))?.[1] ?? host;
}

// Where the event is: a room, a call, or both ("Studio 2 / Google Meet").
// `isCall` when the only place is a call link, which takes the video icon.
export function invitePlace(invite: Pick<CalendarEvent, "location" | "conference_url">): { label: string; isCall: boolean } | null {
  const location = invite.location?.trim() || null;
  const conference = invite.conference_url?.trim() || null;
  if (location && callHost(location)) return { label: callName(location), isCall: true };
  if (location && conference) return { label: `${location} / ${callName(conference)}`, isCall: false };
  if (location) return { label: location, isCall: false };
  if (conference) return { label: callName(conference), isCall: true };
  return null;
}

// The location to show beside a Join button: none when it is only the
// meeting's own link, which Join already opens
export function shownLocation(invite: Pick<CalendarEvent, "location" | "conference_url">): string | null {
  const location = invite.location?.trim() || null;
  if (!location) return null;
  if (invite.conference_url?.trim() && callHost(location)) return null;
  return location;
}

export type InviteState = "unanswered" | RsvpStatus | "past" | "cancelled" | "info";

type Answerable = Timing & Pick<CalendarEvent, "uid" | "method" | "status">;

// Whether the mail is an invite the user can still answer, and how they did
export function inviteState(invite: Answerable, rsvp: string | null | undefined, now: number): InviteState {
  if (invite.method === "CANCEL" || invite.status?.toUpperCase() === "CANCELLED") return "cancelled";
  if (invite.method !== "REQUEST" || !invite.uid) return "info";
  if (inviteEnd(invite) <= now) return "past";
  return isRsvpAnswer(rsvp) ? rsvp : "unanswered";
}

const ANSWER_SENTENCES: Record<string, string> = {
  unanswered: "You have not answered.",
  accepted: "You're going.",
  tentative: "You said maybe.",
  declined: "You're not going.",
  cancelled: "Cancelled.",
};

// The row's spoken summary: "Thursday 1 October, 10:30 to 11:30 AM, in 2
// days. Overlaps Dentist, 11:00 AM. You have not answered."
export function inviteSummary(
  invite: Answerable,
  now: Date,
  opts: { rsvp: string | null | undefined; clashes?: { title: string; start: number }[]; locale?: string },
): string {
  const locale = localeOrApp(opts.locale);
  const start = new Date(inviteStart(invite));
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(start);
  const times = invite.all_day
    ? "all day"
    : invite.end_time
      ? `${formatClock(start, locale)} to ${formatClock(new Date(invite.end_time), locale)}`
      : formatClock(start, locale);
  const away = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(dayOffset(start, now), "day");
  const sentences = [`${day}, ${times}, ${away}.`];
  const clashes = opts.clashes ?? [];
  if (clashes.length > 0) {
    sentences.push(`Overlaps ${clashes.map(c => `${c.title}, ${formatClock(new Date(c.start), locale)}`).join("; ")}.`);
  }
  const answer = ANSWER_SENTENCES[inviteState(invite, opts.rsvp, now.getTime())];
  if (answer) sentences.push(answer);
  return sentences.join(" ");
}
