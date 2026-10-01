import { createSignal } from "solid-js";
import type { Thread, ThreadGroup } from "../api/tauri";

// A card's rows never move under a resting pointer or the keyboard focus:
// mail that comes in while either is on the card waits, and slides in once
// they leave it.

const order = (groups: ThreadGroup[]) =>
  groups.map(g => `${g.label}\n${g.threads.map(t => t.gmail_thread_id).join("\n")}`).join("\n\n");

// The rows shown, each where it is, with what changed in it, and the new
// rows to hold back; null when the incoming list moves no row
export function holdIncoming(shown: ThreadGroup[], incoming: ThreadGroup[]): { view: ThreadGroup[]; waiting: Set<string> } | null {
  if (order(shown) === order(incoming)) return null;
  const latest = new Map(incoming.flatMap(g => g.threads).map(t => [t.gmail_thread_id, t]));
  const shownIds = new Set(shown.flatMap(g => g.threads).map(t => t.gmail_thread_id));
  const view = shown.map(group => ({ ...group, threads: group.threads.map(t => latest.get(t.gmail_thread_id) ?? t) }));
  const waiting = new Set([...latest.keys()].filter(id => !shownIds.has(id)));
  return { view, waiting };
}

// The incoming list once the hold ends: its rows that are still shown, as
// they are now (a row acted on while held keeps what was done to it), and
// the ones held back. A row acted away while held stays away.
export function releaseHeld(current: ThreadGroup[], incoming: ThreadGroup[], waiting: Set<string>): ThreadGroup[] {
  const now = new Map<string, Thread>(current.flatMap(g => g.threads).map(t => [t.gmail_thread_id, t]));
  return incoming
    .map(group => ({
      ...group,
      threads: group.threads
        .filter(t => now.has(t.gmail_thread_id) || waiting.has(t.gmail_thread_id))
        .map(t => now.get(t.gmail_thread_id) ?? t),
    }))
    .filter(group => group.threads.length > 0);
}

// Whether each card is held: the pointer rests on it, or the keyboard focus
// is in it. A pointer that passes out and back within `leaveMs` keeps the
// hold; `onRelease` runs as a card stops being held.
export function createPointerHold(onRelease: (key: string) => void, leaveMs = 300) {
  const pointer = new Set<string>();
  const focus = new Set<string>();
  const leaving = new Map<string, ReturnType<typeof setTimeout>>();

  const held = (key: string) => pointer.has(key) || focus.has(key) || leaving.has(key);
  const settle = (key: string) => {
    if (!held(key)) onRelease(key);
  };

  return {
    held,
    enter(key: string) {
      clearTimeout(leaving.get(key));
      leaving.delete(key);
      pointer.add(key);
    },
    leave(key: string) {
      if (!pointer.delete(key)) return;
      clearTimeout(leaving.get(key));
      leaving.set(key, setTimeout(() => {
        leaving.delete(key);
        settle(key);
      }, leaveMs));
    },
    focus(key: string, inside: boolean) {
      if (inside) {
        focus.add(key);
        return;
      }
      if (focus.delete(key)) settle(key);
    },
  };
}

// Synced mail for each card, shown at once or held while the card is held.
// `waiting` is the whole list held back, for counting the unread in it.
// When the hold ends, `onRelease` gets the new rows' ids and lets the list in
// with `letIn`, so it can measure the rows on either side of that.
export function createNewMailHold(board: {
  read: (cardId: string) => ThreadGroup[] | undefined;
  write: (cardId: string, groups: ThreadGroup[]) => void;
  // What the card's list was fetched for (its account and query)
  fetchedFor: (cardId: string) => string | undefined;
  onRelease: (cardId: string, entering: Set<string>, letIn: () => void) => void;
}) {
  type Held = { incoming: ThreadGroup[]; waiting: Set<string>; fetched: string | undefined };
  const [held, setHeld] = createSignal(new Map<string, Held>());
  const update = (change: (map: Map<string, Held>) => void) => {
    const next = new Map(held());
    change(next);
    setHeld(next);
  };

  const pointer = createPointerHold(cardId => {
    const entry = held().get(cardId);
    if (!entry) return;
    update(map => map.delete(cardId));
    const current = board.read(cardId);
    if (!current || entry.fetched !== board.fetchedFor(cardId)) return;
    board.onRelease(cardId, entry.waiting, () => board.write(cardId, releaseHeld(current, entry.incoming, entry.waiting)));
  });

  return {
    ...pointer,
    show(cardId: string, incoming: ThreadGroup[]) {
      const shown = board.read(cardId);
      const hold = shown && pointer.held(cardId) ? holdIncoming(shown, incoming) : null;
      if (!hold) {
        if (held().has(cardId)) update(map => map.delete(cardId));
        board.write(cardId, incoming);
        return;
      }
      update(map => map.set(cardId, { incoming, waiting: hold.waiting, fetched: board.fetchedFor(cardId) }));
      board.write(cardId, hold.view);
    },
    waiting(cardId: string): ThreadGroup[] | undefined {
      return held().get(cardId)?.incoming;
    },
    forget(cardId: string) {
      if (held().has(cardId)) update(map => map.delete(cardId));
    },
  };
}
