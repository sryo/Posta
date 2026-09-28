import type { ThreadGroup } from "../api/tauri";

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

// Archive only removes INBOX, so the thread should vanish only from cards
// whose query is inbox-scoped: cards like has:attachment or is:starred still
// match it on the server. Trash and spam remove it everywhere.
export function actionRemovesFromCard(action: string, cardQuery: string): boolean {
  if (action === "trash" || action === "spam") return true;
  if (action !== "archive") return false;
  const q = cardQuery.toLowerCase();
  return q.includes("in:inbox") || q.includes("is:inbox") || q.includes("label:inbox") || q.includes("category:");
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
