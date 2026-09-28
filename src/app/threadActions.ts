import type { Thread, ThreadGroup } from "../api/tauri";

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
  threadIds: string[];
  add: string[];
  remove: string[];
}

// What undoing a label change must do to each thread: take back only the
// labels the change actually added, and put back only the ones it removed.
// A thread whose labels before the change aren't known gets the whole change
// reversed.
export function undoLabelChanges(
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
    const reversal = reversals.get(key) ?? { threadIds: [], add, remove };
    reversal.threadIds.push(id);
    reversals.set(key, reversal);
  }
  return [...reversals.values()];
}

// The undo toast's description of an action
export function actionLabel(action: string, count: number): string {
  const threads = `${count} thread${count === 1 ? "" : "s"}`;
  switch (action) {
    case "archive": return `Archived ${threads}`;
    case "inbox": return `Moved ${threads} to inbox`;
    case "star": return `Starred ${threads}`;
    case "unstar": return `Removed star from ${threads}`;
    case "trash": return `Deleted ${threads}`;
    case "read": return `Marked ${threads} as read`;
    case "unread": return `Marked ${threads} as unread`;
    case "important": return `Marked ${threads} as important`;
    case "notImportant": return `Marked ${threads} as not important`;
    case "spam": return `Moved ${threads} to spam`;
    default: return `Modified ${threads}`;
  }
}

export function actionFailureLabel(action: string, count: number): string {
  const threads = `${count} thread${count === 1 ? "" : "s"}`;
  switch (action) {
    case "archive": return `Couldn't archive ${threads}`;
    case "inbox": return `Couldn't move ${threads} to inbox`;
    case "star": return `Couldn't star ${threads}`;
    case "unstar": return `Couldn't remove the star from ${threads}`;
    case "trash": return `Couldn't delete ${threads}`;
    case "read": return `Couldn't mark ${threads} as read`;
    case "unread": return `Couldn't mark ${threads} as unread`;
    case "important": return `Couldn't mark ${threads} as important`;
    case "notImportant": return `Couldn't mark ${threads} as not important`;
    case "spam": return `Couldn't move ${threads} to spam`;
    default: return `Couldn't change ${threads}`;
  }
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
