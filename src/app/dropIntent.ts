import type { Card, Thread } from "../api/tauri";
import { actionRemovesFromCard, type LabelChange } from "./threadActions";
import { cardWouldList, gmailLabelName } from "./queryMatch";
import { queryWords } from "./queryTokens";
import { eventFromThread } from "./eventForm";
import { formatWhen } from "./dateFormat";
import { personName } from "./people";
import { shortName } from "./eventSuggestions";
import { toDateInputString } from "../utils";

// What dropping a thread on a card does, worked out from the card's query,
// in the words its header shows while the thread is over it
export type DropIntent =
  // A label change; `alt` names what ⌥ changes, `done` is the toast's words
  | { kind: "labels"; change: LabelChange; text: string; alt?: string; done: string }
  // A new event about the thread, at the time its subject names if any
  | { kind: "event"; text: string; event: { summary: string; attendees: string; startDate?: string; startTime?: string; endDate?: string; endTime?: string } }
  // Nothing a drop can do there, said plainly
  | { kind: "none"; text: string };

export interface DropContext {
  // A user label's id by its name as a query writes it, and its name by id
  labelId: (name: string) => string | undefined;
  labelName: (id: string) => string;
  accountEmail: string;
  now: Date;
  locale?: string;
  // The card shows another account's mail than the thread's
  otherAccount?: boolean;
}

type DropCard = Pick<Card, "id" | "name" | "query" | "card_type">;

// The label each settable word of a query stands for, and the verb that sets it
const SETTABLE: Record<string, { label: string; verb: string; done: string }> = {
  "in:inbox": { label: "INBOX", verb: "Move to Inbox", done: "Moved to Inbox" },
  "is:inbox": { label: "INBOX", verb: "Move to Inbox", done: "Moved to Inbox" },
  "label:inbox": { label: "INBOX", verb: "Move to Inbox", done: "Moved to Inbox" },
  "is:starred": { label: "STARRED", verb: "Star", done: "Starred" },
  "label:starred": { label: "STARRED", verb: "Star", done: "Starred" },
  "is:important": { label: "IMPORTANT", verb: "Mark important", done: "Marked important" },
  "label:important": { label: "IMPORTANT", verb: "Mark important", done: "Marked important" },
  "is:unread": { label: "UNREAD", verb: "Mark unread", done: "Marked unread" },
};

export function dropIntent(thread: Thread, source: DropCard, target: DropCard, alt: boolean, ctx: DropContext): DropIntent | null {
  if (target.id === source.id) return null;
  if (ctx.otherAccount) return { kind: "none", text: "Can't move mail to another account" };
  if (target.card_type === "calendar") return eventIntent(thread, ctx);

  const cannot: DropIntent = { kind: "none", text: `Can't add mail to ${target.name}` };
  const words = queryWords(target.query);
  if (words.length === 0) return cannot;
  const sets: { label: string; verb: string; done: string }[] = [];
  for (const { operator } of words) {
    if (!operator || operator.negated) return cannot;
    const key = `${operator.op}:${operator.value.toLowerCase()}`;
    const system = SETTABLE[key];
    if (system) {
      sets.push(system);
      continue;
    }
    const id = operator.op === "label" ? ctx.labelId(gmailLabelName(operator.value)) : undefined;
    if (!id) return cannot;
    const name = ctx.labelName(id);
    sets.push({ label: id, verb: `Label ${name}`, done: `Labelled ${name}` });
  }

  const labels = thread.unread_count > 0 ? [...thread.labels, "UNREAD"] : thread.labels;
  if (cardWouldList(target.query, labels, ctx.labelId) === true) return { kind: "none", text: `Already in ${target.name}` };
  const adding = sets.filter(s => !labels.includes(s.label));
  const add = adding.map(s => s.label);
  const verbs = adding.map((s, i) => (i === 0 ? s.verb : s.verb.charAt(0).toLowerCase() + s.verb.slice(1))).join(" and ");
  const done = adding.map((s, i) => (i === 0 ? s.done : s.done.charAt(0).toLowerCase() + s.done.slice(1))).join(" and ");

  // Filing under a label takes a thread out of the Inbox it came from, as
  // archiving does; ⌥ keeps it there
  const files = adding.some(s => !(s.label in SYSTEM_LABELS));
  const leaves = files && thread.labels.includes("INBOX") && !add.includes("INBOX") && actionRemovesFromCard("archive", source.query);
  if (leaves && !alt) {
    return { kind: "labels", change: { add, remove: ["INBOX"] }, text: `${verbs} · leaves ${source.name}`, alt: "⌥ keeps it", done: `${done}, out of ${source.name}` };
  }
  if (leaves) {
    return { kind: "labels", change: { add, remove: [] }, text: `${verbs} · stays in ${source.name}`, done: `${done}, kept in ${source.name}` };
  }
  const stays = add.includes("INBOX") || files ? "" : ` · stays in ${source.name}`;
  return { kind: "labels", change: { add, remove: [] }, text: `${verbs}${stays}`, done };
}

const SYSTEM_LABELS: Record<string, true> = { INBOX: true, STARRED: true, IMPORTANT: true, UNREAD: true };

function eventIntent(thread: Thread, ctx: DropContext): DropIntent {
  const about = eventFromThread(thread.subject, thread.participants, ctx.accountEmail);
  const guest = about.attendees ? shortName(personName(about.attendees.split(",")[0])) : null;
  const withGuest = guest ? ` with ${guest}` : "";
  const start = timeInSubject(thread.subject, ctx.now);
  if (!start) return { kind: "event", text: `New event${withGuest} · pick a time`, event: about };
  const end = new Date(start.getTime() + 30 * 60_000);
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return {
    kind: "event",
    text: `New event · ${formatWhen(start, ctx.now, ctx.locale)}${withGuest}`,
    event: { ...about, startDate: toDateInputString(start), startTime: hhmm(start), endDate: toDateInputString(end), endTime: hhmm(end) },
  };
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// The moment a subject names: a time ("3pm", "15:00", "8:30 pm", "16h"),
// on the day it names ("Friday", "Mon", "today", "tomorrow"), else the
// time's next coming. Null without a time.
export function timeInSubject(subject: string, now: Date): Date | null {
  const text = subject.toLowerCase();
  const time = /\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?(?![\w:])/.exec(text)
    ?? /\b(\d{1,2})()\s*(am|pm|a\.m\.|p\.m\.)(?!\w)/.exec(text)
    ?? /\b(\d{1,2})h(\d{2})?\b/.exec(text);
  if (!time) return null;
  let hours = Number(time[1]);
  const minutes = time[2] ? Number(time[2]) : 0;
  const meridiem = time[3]?.charAt(0);
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === "p" ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }

  const at = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hours, minutes);
  if (/\btoday\b/.test(text)) return at(0);
  if (/\btomorrow\b/.test(text)) return at(1);
  const day = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu|thurs?|fri|sat)\b/.exec(text);
  if (day) {
    const ahead = (DAYS.indexOf(day[1].slice(0, 3)) - now.getDay() + 7) % 7;
    const moment = at(ahead);
    return moment > now ? moment : at(ahead + 7);
  }
  const today = at(0);
  return today > now ? today : at(1);
}
