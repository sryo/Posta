import { createSignal } from "solid-js";

export type SentState = "sending" | "sent";

// Replies sent from inside a thread, shown where they were written until the
// thread holds them: sending through the undo window and the network call,
// then sent. `known` is the thread's messages when the reply was sent, so
// the one that arrives after is the reply.
export function createSentReplies<T>() {
  interface Entry { threadId: string; item: T; state: SentState; known: Set<string>; queuedAt: number; sentAt?: number }
  const [entries, setEntries] = createSignal<Entry[]>([]);

  const add = (threadId: string, item: T, knownIds: string[]) =>
    setEntries(list => [...list, { threadId, item, state: "sending", known: new Set(knownIds), queuedAt: Date.now() }]);

  const settle = (item: T) =>
    setEntries(list => list.map(e => (e.item === item ? { ...e, state: "sent", sentAt: Date.now() } : e)));

  const drop = (item: T) => setEntries(list => list.filter(e => e.item !== item));

  // Lets go of the thread's sent replies once a message the account sent
  // turns up that wasn't there before
  const arrived = (threadId: string, messages: { id: string; labelIds?: string[] }[]) => {
    const lands = (e: Entry) => e.threadId === threadId && e.state === "sent"
      && messages.some(m => !e.known.has(m.id) && (m.labelIds?.includes("SENT") ?? true));
    if (entries().some(lands)) setEntries(list => list.filter(e => !lands(e)));
  };

  const inThread = (threadId: string) =>
    entries().filter(e => e.threadId === threadId).map(e => ({ item: e.item, state: e.state, queuedAt: e.queuedAt, sentAt: e.sentAt }));

  return { add, settle, drop, arrived, inThread };
}
