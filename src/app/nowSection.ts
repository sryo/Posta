import type { CalendarEvent, ThreadGroup } from "../api/tauri";
import { callName } from "./inviteRow";

// Meetings the user is about to join or is in: from ten minutes before the
// start until the end, their invite rows sit in a "Now" section at the top
// of the card, above the date groups

const MINUTE_MS = 60_000;
const LEAD_MS = 10 * MINUTE_MS;
const DEFAULT_LENGTH_MS = 30 * MINUTE_MS;

function meetingEnd(invite: Pick<CalendarEvent, "start_time" | "end_time">): number {
  return invite.end_time && invite.end_time > invite.start_time ? invite.end_time : invite.start_time + DEFAULT_LENGTH_MS;
}

export function isHappeningNow(invite: CalendarEvent | null, rsvp: string | null | undefined, now: number): boolean {
  if (!invite || invite.all_day || invite.method !== "REQUEST") return false;
  if (invite.status?.toUpperCase() === "CANCELLED" || rsvp === "declined") return false;
  return invite.start_time - LEAD_MS <= now && now < meetingEnd(invite);
}

export type NowGroup<T> = { label: string; threads: T[]; now: true };

export function withNowSection<T, G extends { label: string; threads: T[] }>(
  groups: G[],
  isNow: (thread: T) => boolean,
): (G | NowGroup<T>)[] {
  const live = groups.flatMap(g => g.threads.filter(isNow));
  if (live.length === 0) return groups;
  const rest = groups
    .map(g => ({ ...g, threads: g.threads.filter(t => !live.includes(t)) }))
    .filter(g => g.threads.length > 0);
  return [{ label: "Now", threads: live, now: true }, ...rest];
}

export function isNowGroup(group: ThreadGroup | NowGroup<unknown>): group is NowGroup<ThreadGroup["threads"][number]> {
  return "now" in group && group.now === true;
}

export function meetingProgress(invite: Pick<CalendarEvent, "start_time" | "end_time">, now: number) {
  const total = Math.max(1, Math.round((meetingEnd(invite) - invite.start_time) / MINUTE_MS));
  if (now < invite.start_time) {
    const minutes = Math.max(1, Math.ceil((invite.start_time - now) / MINUTE_MS));
    return { started: false, elapsed: 0, total, percent: 0, text: `Starts in ${minutes} minute${minutes === 1 ? "" : "s"}` };
  }
  const elapsed = Math.min(total, Math.floor((now - invite.start_time) / MINUTE_MS));
  return { started: true, elapsed, total, percent: (elapsed / total) * 100, text: `${elapsed} of ${total} minutes` };
}

export function joinLabel(url: string): string {
  return `Join ${callName(url)}`;
}
