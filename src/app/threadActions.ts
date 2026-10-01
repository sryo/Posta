import type { Thread, ThreadGroup } from "../api/tauri";
import { extractEmail } from "../utils";
import { shortName } from "./people";
import { quoted } from "./quoted";

export interface LabelChange {
  add: string[];
  remove: string[];
}

export function labelChangeFor(action: string): LabelChange {
  switch (action) {
    case "archive": return { add: [], remove: ["INBOX"] };
    case "inbox": return { add: ["INBOX"], remove: [] };
    case "star": return { add: ["STARRED"], remove: [] };
    case "unstar": return { add: [], remove: ["STARRED"] };
    case "trash": return { add: ["TRASH"], remove: [] };
    case "read": return { add: [], remove: ["UNREAD"] };
    case "unread": return { add: ["UNREAD"], remove: [] };
    case "important": return { add: ["IMPORTANT"], remove: [] };
    case "notImportant": return { add: [], remove: ["IMPORTANT"] };
    case "spam": return { add: ["SPAM"], remove: ["INBOX"] };
    default: return { add: [], remove: [] };
  }
}

export interface LabelReversal {
  // The account the change was made in
  accountId: string;
  threadIds: string[];
  add: string[];
  remove: string[];
}

// What undoing a label change must do to each thread: take back only the
// labels the change actually added, and put back only the ones it removed.
// A thread whose labels before the change aren't known gets the whole change
// reversed.
export function undoLabelChanges(
  accountId: string,
  threadIds: string[],
  change: LabelChange,
  before: Map<string, Pick<Thread, "labels" | "unread_count">>,
): LabelReversal[] {
  const reversals = new Map<string, LabelReversal>();
  for (const id of threadIds) {
    const prior = before.get(id);
    const had = (label: string) =>
      !prior || prior.labels.includes(label) || (label === "UNREAD" && prior.unread_count > 0);
    const remove = change.add.filter(label => !prior || !had(label));
    const add = change.remove.filter(had);
    if (add.length === 0 && remove.length === 0) continue;
    const key = `${add.join(",")}|${remove.join(",")}`;
    const reversal = reversals.get(key) ?? { accountId, threadIds: [], add, remove };
    reversal.threadIds.push(id);
    reversals.set(key, reversal);
  }
  return [...reversals.values()];
}

// A toast's words around the threads it names: [before, after]
type Phrase = readonly [string, string];

const DONE: Record<string, Phrase> = {
  archive: ["Archived", ""],
  inbox: ["Moved", " to Inbox"],
  star: ["Starred", ""],
  unstar: ["Unstarred", ""],
  trash: ["Moved", " to Trash"],
  read: ["Marked", " as read"],
  unread: ["Marked", " as unread"],
  important: ["Marked", " as important"],
  notImportant: ["Marked", " as not important"],
  spam: ["Moved", " to spam"],
};

const FAILED: Record<string, Phrase> = {
  archive: ["Couldn't archive", ""],
  inbox: ["Couldn't move", " to Inbox"],
  star: ["Couldn't star", ""],
  unstar: ["Couldn't unstar", ""],
  trash: ["Couldn't delete", ""],
  read: ["Couldn't mark", " as read"],
  unread: ["Couldn't mark", " as unread"],
  important: ["Couldn't mark", " as important"],
  notImportant: ["Couldn't mark", " as not important"],
  spam: ["Couldn't move", " to spam"],
};

const UNDONE: Record<string, Phrase> = {
  archive: ["Unarchived", ""],
  inbox: ["Moved", " out of Inbox"],
  star: ["Unstarred", ""],
  unstar: ["Starred", ""],
  trash: ["Restored", " from Trash"],
  read: ["Marked", " as unread"],
  unread: ["Marked", " as read"],
  important: ["Marked", " as not important"],
  notImportant: ["Marked", " as important"],
  spam: ["Moved", " out of spam"],
};

const UNDO_FAILED: Record<string, Phrase> = {
  archive: ["Couldn't unarchive", ""],
  inbox: ["Couldn't move", " out of Inbox"],
  star: ["Couldn't unstar", ""],
  unstar: ["Couldn't star", ""],
  trash: ["Couldn't restore", " from Trash"],
  read: ["Couldn't mark", " as unread"],
  unread: ["Couldn't mark", " as read"],
  important: ["Couldn't mark", " as not important"],
  notImportant: ["Couldn't mark", " as important"],
  spam: ["Couldn't move", " out of spam"],
};

export interface NamedThread {
  subject: string;
  participants: readonly string[];
}

export interface DescribeScope {
  // The card acted in, and how many threads it held before; null when it
  // has more than it loaded
  card?: { name: string; total: number | null };
  ownEmails?: readonly string[];
}

// Who a thread is from, leaving out the user
function senderOf(thread: NamedThread, ownEmails: readonly string[]): string | null {
  const own = new Set(ownEmails.map(e => e.toLowerCase()));
  const from = thread.participants.find(p => !own.has(extractEmail(p).toLowerCase()));
  return from ? shortName(from) : null;
}

// One thread by its subject, else by whose message it is
function threadName(thread: NamedThread, ownEmails: readonly string[]): string {
  const sender = senderOf(thread, ownEmails);
  return quoted(thread.subject) ?? (sender ? `${sender}'s message` : "a message with no subject");
}

// What a toast calls the threads it acted on: the subject of one, the
// sender of several from one, all of a card it cleared, else a count
function describeThreads([before, after]: Phrase, threads: readonly NamedThread[], { card, ownEmails = [] }: DescribeScope): string {
  const n = threads.length;
  if (n === 1) return `${before} ${threadName(threads[0], ownEmails)}${after}`;
  if (card && card.total === n) return `${before} ${n === 2 ? "both" : `all ${n}`} in ${card.name}${after}`;
  const senders = threads.map(t => senderOf(t, ownEmails));
  if (senders.every(s => s && s === senders[0])) return `${before} ${n} from ${senders[0]}${after}`;
  if (n === 2 && senders[0] && senders[1]) return `${before} 2, from ${senders[0]} and ${senders[1]}${after ? `,${after}` : ""}`;
  return `${before} ${n} threads${after}`;
}

// The undo toast after an action
export function actionMessage(action: string, threads: readonly NamedThread[], scope: DescribeScope = {}): string {
  return describeThreads(DONE[action] ?? ["Changed", ""], threads, scope);
}

export function actionFailureMessage(action: string, threads: readonly NamedThread[], scope: DescribeScope = {}): string {
  return describeThreads(FAILED[action] ?? ["Couldn't change", ""], threads, scope);
}

// What undoing the action did
export function actionUndoneMessage(action: string, threads: readonly NamedThread[], scope: DescribeScope = {}): string {
  return describeThreads(UNDONE[action] ?? ["Undid changes to", ""], threads, scope);
}

export function undoFailureMessage(action: string, threads: readonly NamedThread[], scope: DescribeScope = {}): string {
  return describeThreads(UNDO_FAILED[action] ?? ["Couldn't undo changes to", ""], threads, scope);
}

// A label put on or taken off one thread
export function labelChangeMessage(adding: boolean, labelName: string, thread: NamedThread, outcome: "done" | "failed" = "done"): string {
  const label = quoted(labelName) ?? "the label";
  const verb = adding ? "add" : "remove";
  const done = outcome === "failed" ? `Couldn't ${verb} ${label}` : `${adding ? "Added" : "Removed"} ${label}`;
  return `${done} ${adding ? "to" : "from"} ${threadName(thread, [])}`;
}

// Archive only removes INBOX, so the thread should vanish only from cards
// whose query is inbox-scoped: cards like has:attachment or is:starred still
// match it on the server. Trash and spam remove it everywhere.
export function actionRemovesFromCard(action: string, cardQuery: string): boolean {
  if (action === "trash" || action === "spam") return true;
  if (action !== "archive") return false;
  const q = cardQuery.toLowerCase();
  return q.includes("in:inbox") || q.includes("is:inbox") || q.includes("label:inbox") || q.includes("category:");
}

// Whether a changed thread no card shows could have joined a card with this
// query. Gmail searches leave out spam and trash unless the query asks for
// them, so a thread that only moved there can't have.
export function threadMayJoinCard(thread: Pick<Thread, "labels">, cardQuery: string): boolean {
  const labels = thread.labels;
  if (!(labels.includes("SPAM") || labels.includes("TRASH")) || labels.includes("INBOX")) return true;
  return /\b(in|label):(spam|trash|anywhere)\b/i.test(cardQuery);
}

// The card's groups as they look once the action has succeeded
export function applyThreadAction(
  groups: ThreadGroup[],
  threadIds: string[],
  action: string,
  removeFromCard: boolean,
): ThreadGroup[] {
  const { add, remove } = labelChangeFor(action);
  const targeted = new Set(threadIds);
  return groups.map(group => ({
    ...group,
    threads: group.threads
      .filter(t => !(removeFromCard && targeted.has(t.gmail_thread_id)))
      .map(t => {
        if (!targeted.has(t.gmail_thread_id)) return t;
        const labels = [...t.labels.filter(l => !remove.includes(l)), ...add.filter(l => !t.labels.includes(l))];
        let unread = t.unread_count;
        if (action === "read") unread = 0;
        if (action === "unread" && unread === 0) unread = 1;
        return { ...t, labels, unread_count: unread };
      }),
  }));
}

// The card's groups with the targeted threads as they were before an
// action: back in the slot they left, with the labels they had
export function restoreThreads(
  groups: ThreadGroup[],
  before: ThreadGroup[],
  isTarget: (t: Thread) => boolean,
): ThreadGroup[] {
  const result = groups.map(g => ({ ...g, threads: g.threads.filter(t => !isTarget(t)) }));
  before.forEach((was, groupIndex) => {
    was.threads.forEach((t, index) => {
      if (!isTarget(t)) return;
      let group = result.find(g => g.label === was.label);
      if (!group) {
        group = { label: was.label, threads: [] };
        const after = before.slice(groupIndex + 1).map(g => g.label);
        const at = result.findIndex(g => after.includes(g.label));
        result.splice(at === -1 ? result.length : at, 0, group);
      }
      group.threads.splice(Math.min(index, group.threads.length), 0, t);
    });
  });
  return result;
}

const ORDINAL = new Intl.PluralRules("en", { type: "ordinal" });
const SUFFIX: Record<string, string> = { one: "st", two: "nd", few: "rd", other: "th" };

// Where an undone thread is back in its card: " · back 2nd in Inbox"
export function backInPlace(groups: ThreadGroup[], threadId: string, cardName: string): string {
  const index = groups.flatMap(g => g.threads).findIndex(t => t.gmail_thread_id === threadId);
  if (index === -1) return "";
  const n = index + 1;
  return ` · back ${n}${SUFFIX[ORDINAL.select(n)]} in ${cardName}`;
}
