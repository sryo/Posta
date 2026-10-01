import { createSignal } from "solid-js";
import type { FullThread, Thread } from "../api/tauri";
import { compareVersions, seriesKey, versionMarker } from "./attachments";
import { findHeader, messageDate } from "./messages";
import { formatShortDate } from "./dateFormat";
import { extractEmail, extractName, splitEmailList } from "../utils";
import { shortName } from "./people";

// A file opened in a thread: when its message came, and every address in the
// thread, which the newer file's sender must be one of
export interface SeriesFile {
  filename: string;
  date: number;
  threadId: string;
  accountId: string;
  people: string[];
}

export interface LaterVersion {
  threadId: string;
  cardId: string;
  subject: string;
  who: string;
  // "v3", or null when the names can't be ordered and the date alone says it
  label: string | null;
  date: number;
}

const firstName = (from: string) => extractName(from)?.split(/\s+/)[0] || shortName(from);

// The newest file of the same series in another of the account's loaded
// threads, sent later by someone in this thread. The listing has the files'
// names, not who sent them when, so the threads that could hold one are
// `missing` until `fetched` has them. When both names carry a version, the
// later message must carry the higher one, or nothing is said.
export function laterVersionOf(
  file: SeriesFile,
  pool: { thread: Thread; cardId: string }[],
  fetched: Record<string, FullThread | undefined>,
): { found: LaterVersion | null; missing: string[] } {
  const key = seriesKey(file.filename);
  if (!key) return { found: null, missing: [] };
  const marker = versionMarker(file.filename);
  const people = new Set(file.people.map(p => p.toLowerCase()));
  const missing: string[] = [];
  let found: LaterVersion | null = null;
  const seen = new Set<string>();
  for (const { thread, cardId } of pool) {
    const id = thread.gmail_thread_id;
    if (id === file.threadId || seen.has(id) || thread.account_id !== file.accountId || thread.last_message_date <= file.date) continue;
    seen.add(id);
    const files = thread.attachments.filter(a => a.filename !== file.filename && seriesKey(a.filename) === key);
    if (files.length === 0) continue;
    const details = fetched[id];
    if (!details) {
      missing.push(id);
      continue;
    }
    for (const a of files) {
      const message = details.messages.find(m => m.id === a.message_id);
      const from = findHeader(message?.payload?.headers, "From");
      const date = message && messageDate(message)?.getTime();
      if (!from || !date || date <= file.date || !people.has(extractEmail(from).toLowerCase())) continue;
      const order = compareVersions(versionMarker(a.filename), marker);
      if (order !== null && order <= 0) continue;
      if (found && found.date >= date) continue;
      found = { threadId: id, cardId, subject: thread.subject, who: firstName(from), label: order === null ? null : versionMarker(a.filename)!.label, date };
    }
  }
  return { found, missing };
}

// "Martín sent v3 on Sep 28, in “Obra Belgrano: ajustes”." and its button
export function laterVersionLine(v: LaterVersion, locale?: string): { text: string; action: string } {
  const day = formatShortDate(new Date(v.date), locale);
  return v.label
    ? { text: `${v.who} sent ${v.label} on ${day}, in “${v.subject}”.`, action: `Open ${v.label}` }
    : { text: `A later one came ${day}, in “${v.subject}”.`, action: "Open it" };
}

// Every address a thread's messages came from or went to
function threadPeople(thread: FullThread): string[] {
  return thread.messages.flatMap(m => ["From", "To", "Cc"].flatMap(name =>
    splitEmailList(findHeader(m.payload?.headers, name) ?? "").map(extractEmail)));
}

// laterVersionOf over the threads loaded in the cards, fetching the ones it
// needs to know who sent a file when, once each
export function createLaterVersions(opts: {
  pool: () => { thread: Thread; cardId: string }[];
  fetchThread: (accountId: string, threadId: string) => Promise<FullThread>;
}) {
  const [fetched, setFetched] = createSignal<Record<string, FullThread>>({});
  const asked = new Set<string>();
  return (thread: FullThread, accountId: string, messageId: string, filename: string): LaterVersion | null => {
    const message = thread.messages.find(m => m.id === messageId);
    const date = message && messageDate(message)?.getTime();
    if (!date) return null;
    const file = { filename, date, threadId: thread.id, accountId, people: threadPeople(thread) };
    const { found, missing } = laterVersionOf(file, opts.pool(), fetched());
    for (const id of missing) {
      if (asked.has(id)) continue;
      asked.add(id);
      opts.fetchThread(accountId, id).then(t => setFetched(f => ({ ...f, [id]: t })), () => {});
    }
    return found;
  };
}
