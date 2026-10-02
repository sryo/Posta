import { createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import type { Thread } from "../api/tauri";
import { extractEmail } from "../utils";
import { dayOffset, formatShortDate } from "./dateFormat";
import { nameInThreads } from "./people";
import { firstNames, namesLine } from "./replyWords";

const LIVE_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;
const PREFIX = /^\s*(re|fwd?|fw|rv|aw|wg|tr)\s*(\[\d+\])?\s*:\s*/i;
const GENERIC = new Set(["hi", "hello", "hey", "hola", "question", "questions", "quick question", "update", "follow up", "follow-up", "followup", "thanks", "gracias", "consulta"]);

// The subject without its reply or forward prefixes, as written
function bareSubject(subject: string): string {
  let s = subject;
  while (PREFIX.test(s)) s = s.replace(PREFIX, "");
  return s.trim();
}

// A subject as two emails about the same thing share it: no Re:/Fwd:, no
// case, no punctuation around it
export function normalizeSubject(subject: string): string {
  return bareSubject(subject).toLowerCase().replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "").replace(/\s+/g, " ");
}

const matchable = (normalized: string) => normalized.length >= 4 && !GENERIC.has(normalized);

// A thread from the last 45 days with the same subject that everyone in To
// has written in, the most recent first
export function findLiveThread(subject: string, to: readonly string[], threads: readonly Thread[], ownEmails: readonly string[], now: number): Thread | null {
  const wanted = normalizeSubject(subject);
  const own = new Set(ownEmails.map(e => e.toLowerCase()));
  const people = to.map(a => extractEmail(a).trim().toLowerCase()).filter(e => e && !own.has(e));
  if (!matchable(wanted) || people.length === 0) return null;
  let best: Thread | null = null;
  for (const thread of threads) {
    if (now - thread.last_message_date > LIVE_DAYS * DAY_MS || normalizeSubject(thread.subject) !== wanted) continue;
    const participants = new Set(thread.participants.map(p => extractEmail(p).toLowerCase()));
    if (!people.every(p => participants.has(p))) continue;
    if (!best || thread.last_message_date > best.last_message_date) best = thread;
  }
  return best;
}

// The Gmail search for such a thread beyond the loaded mail
export function liveThreadQuery(subject: string): string {
  return `subject:"${bareSubject(subject).replace(/"/g, "")}" newer_than:${LIVE_DAYS}d`;
}

// 'You and Ana already have "Q3 budget" going, last on Sep 25.'
export function liveThreadLine(
  thread: Thread,
  to: readonly string[],
  ownEmails: readonly string[],
  nameFor: ((email: string) => string | undefined) | undefined,
  now: Date,
  locale?: string,
): string {
  const names = firstNames(to, ownEmails, email => nameFor?.(email) || nameInThreads(email, [thread]));
  const last = new Date(thread.last_message_date);
  const offset = dayOffset(last, now);
  const when = offset === 0 ? "today" : offset === -1 ? "yesterday" : `on ${formatShortDate(last, locale)}`;
  return `${namesLine(["You", ...names])} already have "${bareSubject(thread.subject)}" going, last ${when}.`;
}

const SETTLE_MS = 600;

// The live thread a new email's subject and To match, looked for once typing
// has stopped for a moment: first in the loaded mail, then with one search.
// It goes as soon as either field changes so the match no longer holds.
export function createLiveThreadMatch(opts: {
  active: Accessor<boolean>;
  subject: Accessor<string>;
  to: Accessor<string[]>;
  threads: Accessor<readonly Thread[]>;
  ownEmails: Accessor<readonly string[]>;
  search: (query: string) => Promise<Thread[]>;
  now?: () => number;
}): Accessor<Thread | null> {
  const now = opts.now ?? Date.now;
  const [match, setMatch] = createSignal<Thread | null>(null);
  let timer: number | undefined;
  let run = 0;
  createEffect(() => {
    const active = opts.active();
    const subject = opts.subject();
    const to = opts.to();
    clearTimeout(timer);
    const stamp = ++run;
    const current = untrack(match);
    if (current && !(active && findLiveThread(subject, to, [current], untrack(opts.ownEmails), now()))) setMatch(null);
    if (!active || !matchable(normalizeSubject(subject))) return;
    timer = window.setTimeout(async () => {
      const own = opts.ownEmails();
      const loaded = findLiveThread(subject, to, opts.threads(), own, now());
      if (loaded || to.length === 0) return setMatch(loaded);
      const found = await opts.search(liveThreadQuery(subject)).catch(() => []);
      if (stamp === run) setMatch(findLiveThread(subject, to, found, own, now()));
    }, SETTLE_MS);
  });
  onCleanup(() => clearTimeout(timer));
  return match;
}
