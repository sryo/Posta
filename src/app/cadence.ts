// Mail that usually comes around the same day each month (a bill, a payslip)
// and hasn't yet. Each card keeps, per sender, the day of the month their
// first letter came in each month it saw.

import { createEffect, createSignal } from "solid-js";
import type { Thread } from "../api/tauri";
import { safeGetJSON, safeSetJSON } from "../shared/storage";
import { extractEmail } from "../utils";
import { shortName } from "./people";

export type CadenceHistory = Record<string, { sender: string; months: Record<string, number> }>;
export type Overdue = { email: string; sender: string; usualDay: number };
export type CadenceNotice = Overdue & { text: string; query: string };

const MONTHS_LOOKED_AT = 6;
const MONTHS_NEEDED = 5;
// Every first arrival within this many days of each other: the 2nd to the 5th
const MAX_SPREAD_DAYS = 3;
const GRACE_DAYS = 2;
const MAX_NOTICES = 2;
const MONTHS_KEPT = 12;

const monthKey = (year: number, month: number) => {
  const d = new Date(year, month, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthOf = (date: Date, back = 0) => monthKey(date.getFullYear(), date.getMonth() - back);

// The history with the first day of the month each lone sender's mail came;
// the same object when nothing earlier came, so it needn't be saved again
export function recordArrivals(history: CadenceHistory, threads: Thread[], ownEmails: readonly string[]): CadenceHistory {
  const own = new Set(ownEmails.map(e => e.toLowerCase()));
  let next = history;
  for (const thread of threads) {
    if (thread.participants.length !== 1) continue;
    const sender = thread.participants[0];
    const email = extractEmail(sender).toLowerCase();
    if (!email || own.has(email)) continue;
    const date = new Date(thread.last_message_date);
    const month = monthOf(date);
    const known = next[email]?.months[month];
    if (known !== undefined && known <= date.getDate()) continue;
    if (next === history) next = { ...history };
    const entry = next[email] ?? { sender, months: {} };
    next[email] = { sender: entry.sender, months: { ...entry.months, [month]: date.getDate() } };
  }
  return next;
}

function pruned(history: CadenceHistory, now: Date): CadenceHistory {
  const oldest = monthOf(now, MONTHS_KEPT);
  const kept: CadenceHistory = {};
  for (const [email, { sender, months }] of Object.entries(history)) {
    const recent = Object.fromEntries(Object.entries(months).filter(([month]) => month >= oldest));
    if (Object.keys(recent).length > 0) kept[email] = { sender, months: recent };
  }
  return kept;
}

// Senders whose mail came in at least 5 of the last 6 months, each time
// within a few days of the month, and not yet this month though it's two
// days past the latest of those days. Two months missed in a row and a
// sender is no longer expected.
export function overdueSenders(history: CadenceHistory, now: Date): Overdue[] {
  const overdue: Overdue[] = [];
  for (const [email, { sender, months }] of Object.entries(history)) {
    if (months[monthOf(now)] !== undefined) continue;
    const seen = Array.from({ length: MONTHS_LOOKED_AT }, (_, i) => months[monthOf(now, i + 1)]);
    if (seen[0] === undefined && seen[1] === undefined) continue;
    const days = seen.filter((d): d is number => d !== undefined);
    if (days.length < MONTHS_NEEDED) continue;
    const usualDay = Math.max(...days);
    if (usualDay - Math.min(...days) > MAX_SPREAD_DAYS) continue;
    if (now.getDate() <= usualDay + GRACE_DAYS) continue;
    overdue.push({ email, sender, usualDay });
  }
  return overdue.sort((a, b) => a.usualDay - b.usualDay).slice(0, MAX_NOTICES);
}

function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  return `${day}${suffix}`;
}

export function overdueLine(overdue: Overdue): string {
  return `${shortName(overdue.sender)} usually writes by the ${ordinal(overdue.usualDay)}. Nothing yet this month.`;
}

// Whether the mail came this month after all, filed where the card can't see it
export function arrivalQuery(email: string, now: Date): string {
  return `from:${email} newer_than:${now.getDate()}d`;
}

const searchQuery = (email: string) => `from:${email} newer_than:40d`;

type CheckState = { status: "missing" | "found" | "failed"; day: string };

// Each card's overdue senders, at most two, said only once one Gmail query
// confirms nothing came this month. The query runs once a day per sender,
// one at a time; a sender found this month isn't asked about again.
export function createCadence(opts: {
  cards: () => { id: string; account_id: string }[];
  threadsOf: (cardId: string) => Thread[] | undefined;
  ownEmails: () => readonly string[];
  now?: () => number;
  check: (accountId: string, query: string) => Promise<boolean>;
}) {
  const now = () => new Date((opts.now ?? Date.now)());
  const stored: Record<string, CadenceHistory> = {};
  const storedFor = (cardId: string) => (stored[cardId] ??= safeGetJSON<CadenceHistory>(`cadence:${cardId}`, {}));
  const historyOf = (cardId: string) => recordArrivals(storedFor(cardId), opts.threadsOf(cardId) ?? [], opts.ownEmails());

  createEffect(() => {
    for (const card of opts.cards()) {
      const history = historyOf(card.id);
      if (history === stored[card.id]) continue;
      stored[card.id] = pruned(history, now());
      safeSetJSON(`cadence:${card.id}`, stored[card.id]);
    }
  });

  const [dismissed, setDismissed] = createSignal<Record<string, string>>(safeGetJSON("cadenceDismissed", {}));
  const [checks, setChecks] = createSignal<Record<string, CheckState>>({});
  const asked = new Set<string>();
  let queue = Promise.resolve();

  function ask(key: string, day: string, accountId: string, query: string) {
    if (asked.has(`${key}|${day}`)) return;
    asked.add(`${key}|${day}`);
    queue = queue.then(async () => {
      let status: CheckState["status"];
      try {
        status = (await opts.check(accountId, query)) ? "found" : "missing";
      } catch {
        status = "failed";
      }
      setChecks(c => ({ ...c, [key]: { status, day } }));
    });
  }

  function notices(cardId: string): CadenceNotice[] {
    const card = opts.cards().find(c => c.id === cardId);
    if (!card) return [];
    const today = now();
    const month = monthOf(today);
    const day = today.toDateString();
    const result: CadenceNotice[] = [];
    for (const overdue of overdueSenders(historyOf(cardId), today)) {
      if (dismissed()[`${cardId}|${overdue.email}`] === month) continue;
      const key = `${cardId}|${overdue.email}|${month}`;
      const state = checks()[key];
      if (state?.status === "found") continue;
      if (state?.day !== day) {
        ask(key, day, card.account_id, arrivalQuery(overdue.email, today));
        continue;
      }
      if (state.status === "missing") result.push({ ...overdue, text: overdueLine(overdue), query: searchQuery(overdue.email) });
    }
    return result;
  }

  function dismiss(cardId: string, email: string) {
    const next = { ...dismissed(), [`${cardId}|${email}`]: monthOf(now()) };
    setDismissed(next);
    safeSetJSON("cadenceDismissed", next);
  }

  return { notices, dismiss };
}
