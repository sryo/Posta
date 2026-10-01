import type { Thread, ThreadGroup } from "../api/tauri";
import { cardWouldList } from "./queryMatch";

// The backend's date buckets, newest first (classify_date in gmail/mod.rs):
// calendar days in local time, the week starting on Monday
const BUCKETS = ["Today", "Yesterday", "This week", "Last 30 days", "Older"];

export function dateGroupLabel(timestamp: number, now: Date): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = day(now);
  const date = day(new Date(timestamp));
  const daysAgo = Math.round((today - date) / 86400000);
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo <= (now.getDay() + 6) % 7) return "This week";
  if (daysAgo <= 30) return "Last 30 days";
  return "Older";
}

// A card's date groups with `thread` where the card would list it: in its
// date bucket, newest first. Null when the card already has it, or when it is
// older than everything loaded and more pages follow (`complete` false).
export function placeThread(groups: ThreadGroup[], thread: Thread, now: Date, complete: boolean): ThreadGroup[] | null {
  const all = groups.flatMap(g => g.threads);
  if (all.some(t => t.gmail_thread_id === thread.gmail_thread_id)) return null;
  const oldest = all[all.length - 1];
  if (!complete && oldest && thread.last_message_date < oldest.last_message_date) return null;

  const label = dateGroupLabel(thread.last_message_date, now);
  const index = groups.findIndex(g => g.label === label);
  if (index >= 0) {
    const threads = [...groups[index].threads];
    const at = threads.findIndex(t => t.last_message_date < thread.last_message_date);
    threads.splice(at < 0 ? threads.length : at, 0, thread);
    return groups.map((g, i) => (i === index ? { ...g, threads } : g));
  }
  const rank = BUCKETS.indexOf(label);
  const before = groups.findIndex(g => BUCKETS.indexOf(g.label) > rank);
  const next = [...groups];
  next.splice(before < 0 ? next.length : before, 0, { label, threads: [thread] });
  return next;
}

// The cards that now list `thread`, by what its labels answer of their
// queries, each with its groups once the thread is placed in them
export function placeInCards(
  cards: { id: string; query: string; groups: ThreadGroup[]; complete: boolean }[],
  thread: Thread,
  labelId: (name: string) => string | undefined,
  now: Date,
): Record<string, ThreadGroup[]> {
  const labels = thread.unread_count > 0 ? [...thread.labels, "UNREAD"] : thread.labels;
  const placed: Record<string, ThreadGroup[]> = {};
  for (const card of cards) {
    if (cardWouldList(card.query, labels, labelId) !== true) continue;
    const groups = placeThread(card.groups, thread, now, card.complete);
    if (groups) placed[card.id] = groups;
  }
  return placed;
}
