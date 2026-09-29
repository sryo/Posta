import type { GoogleCalendarEvent } from "../api/tauri";

// The user's calendar around their unanswered invites, for the day strips.
// One search per account covers every invite that account has on the board:
// ranges are rounded up to a few fixed lengths so cards share a lookup, and
// an answer is reused until it is old. A calendar that can't be read is left
// alone for the same while; its invites show no strip.

const DAY_MS = 86_400_000;
const RANGES_DAYS = [7, 14, 30, 60, 90];

// The calendar range, in days from now, that reaches `until`
export function rangeDaysFor(until: number, now: number): number | null {
  const needed = Math.max(1, Math.ceil((until - now) / DAY_MS));
  return RANGES_DAYS.find(days => days >= needed) ?? null;
}

export type DayEvents = { events: GoogleCalendarEvent[]; until: number };

export function createInviteDayLookups(opts: {
  fetch: (accountId: string, query: string) => Promise<GoogleCalendarEvent[]>;
  onEvents: (accountId: string, entry: DayEvents) => void;
  now?: () => number;
  maxAgeMs?: number;
}) {
  const now = opts.now ?? Date.now;
  const maxAge = opts.maxAgeMs ?? 10 * 60_000;
  // What each account's last search covers, or is about to
  const covered = new Map<string, { until: number; at: number }>();

  function request(accountId: string, until: number) {
    const t = now();
    const days = rangeDaysFor(until, t);
    if (days === null) return;
    const known = covered.get(accountId);
    if (known && known.until >= until && t - known.at < maxAge) return;
    const reach = t + days * DAY_MS;
    covered.set(accountId, { until: reach, at: t });
    opts.fetch(accountId, `calendar:${days}d`)
      .then(events => opts.onEvents(accountId, { events, until: reach }))
      .catch(e => console.warn("Failed to read the calendar for invite day strips:", e));
  }

  return { request };
}
