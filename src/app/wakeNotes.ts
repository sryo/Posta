import type { Thread } from "../api/tauri";
import { extractEmail } from "../utils";
import { dayOffset, formatClock, localeOrApp } from "./dateFormat";
import { personName } from "./people";

// After the Mac sleeps, the mail that came in the meantime arrives with the
// first syncs. Instead of a banner per thread, each card that got any gets
// one note: "Since 23:10 — Clients: 2 new, latest from Lena Ortiz: …".

export interface CardNote {
  card_id: string;
  title: string;
  body: string;
}

function sinceTitle(sleptAt: number, now: number, locale?: string): string {
  const slept = new Date(sleptAt);
  const clock = formatClock(slept, locale);
  if (dayOffset(slept, new Date(now)) >= -1) return `Since ${clock}`;
  const weekday = new Intl.DateTimeFormat(localeOrApp(locale), { weekday: "short" }).format(slept);
  return `Since ${weekday} ${clock}`;
}

function sender(thread: Thread, ownEmails: readonly string[]): string {
  const own = new Set(ownEmails.map(e => e.toLowerCase()));
  const other = thread.participants.find(p => !own.has(extractEmail(p).toLowerCase()));
  return personName(other ?? thread.participants[0] ?? "");
}

export function wakeNotes(
  cards: readonly { id: string; name: string }[],
  threadsOf: (cardId: string) => readonly Thread[],
  sleptAt: number,
  now: number,
  ownEmails: readonly string[],
  locale?: string,
): CardNote[] {
  const title = sinceTitle(sleptAt, now, locale);
  return cards.flatMap(card => {
    const arrived = threadsOf(card.id).filter(t => t.unread_count > 0 && t.last_message_date >= sleptAt);
    if (arrived.length === 0) return [];
    const latest = arrived.reduce((a, b) => (b.last_message_date > a.last_message_date ? b : a));
    const count = arrived.length === 1 ? "1 new from" : `${arrived.length} new, latest from`;
    return [{ card_id: card.id, title, body: `${card.name}: ${count} ${sender(latest, ownEmails)}: ${latest.subject}` }];
  });
}

// How long the syncs after waking must stay quiet before the notes go out,
// and how long to wait for a first one; tests shorten them
export const WAKE_DELAYS_MS = { quiet: 4000, giveUp: 120_000 };

/** Calls `post` with when the Mac went to sleep once the syncs after it
 *  woke have been quiet for `quiet` ms; gives up after `giveUp` ms
 *  without one, as when it woke offline */
export function createWakeWatch(post: (sleptAt: number) => void, delays: { quiet: number; giveUp: number }) {
  let sleptAt: number | null = null;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
  const reset = () => {
    clearTimeout(quietTimer);
    clearTimeout(giveUpTimer);
    sleptAt = null;
  };
  return {
    wake(at: number) {
      if (sleptAt === null) {
        sleptAt = at;
        giveUpTimer = setTimeout(reset, delays.giveUp);
      }
    },
    synced() {
      if (sleptAt === null) return;
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        const since = sleptAt!;
        reset();
        post(since);
      }, delays.quiet);
    },
  };
}
