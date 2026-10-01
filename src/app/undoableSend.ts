import { createSignal, onCleanup } from "solid-js";

const TOAST_EXIT_MS = 200;

// Delays each send so it can be undone. Several sends can overlap: each keeps
// its own timer, only the most recent one is offered for undo, and the toast
// stays up until nothing is queued or still going out. Sends queued together
// are undone together.
export function createUndoableSend<T>(opts: {
  delayMs: number;
  send: (item: T) => Promise<void>;
  onFailed: (item: T, error: unknown) => void;
}) {
  interface Entry { item: T; timeoutId: number; queuedAt: number; group: object }
  const [queued, setQueued] = createSignal<Entry[]>([]);
  const [progress, setProgress] = createSignal(0);
  const [toastVisible, setToastVisible] = createSignal(false);
  const [toastClosing, setToastClosing] = createSignal(false);
  let inFlight = 0;
  let progressIntervalId: number | undefined;
  let hideTimeoutId: number | undefined;

  const latest = () => {
    const q = queued();
    return q.length > 0 ? q[q.length - 1] : null;
  };

  function tickProgress() {
    const entry = latest();
    if (!entry) return;
    setProgress(Math.min(100, ((Date.now() - entry.queuedAt) / opts.delayMs) * 100));
  }

  function settle() {
    if (queued().length > 0) return;
    clearInterval(progressIntervalId);
    progressIntervalId = undefined;
    if (inFlight > 0) return;
    setToastClosing(true);
    hideTimeoutId = window.setTimeout(() => {
      setToastVisible(false);
      setToastClosing(false);
      setProgress(0);
    }, TOAST_EXIT_MS);
  }

  function queue(item: T, group: object = {}) {
    clearTimeout(hideTimeoutId);
    setToastClosing(false);
    setToastVisible(true);
    setProgress(0);

    const entry: Entry = { item, timeoutId: 0, queuedAt: Date.now(), group };
    entry.timeoutId = window.setTimeout(async () => {
      // Leave the undo window before the network call so a late undo can't
      // reopen compose while the mail still goes out
      setQueued(q => q.filter(e => e !== entry));
      inFlight++;
      if (queued().length === 0) setProgress(100);
      try {
        await opts.send(item);
      } catch (e) {
        opts.onFailed(item, e);
      } finally {
        inFlight--;
        settle();
      }
    }, opts.delayMs);
    setQueued(q => [...q, entry]);

    if (progressIntervalId === undefined) {
      progressIntervalId = window.setInterval(tickProgress, opts.delayMs / 50);
    }
  }

  // Going away is like quitting: nothing queued goes out
  onCleanup(() => {
    for (const entry of queued()) clearTimeout(entry.timeoutId);
    clearInterval(progressIntervalId);
    clearTimeout(hideTimeoutId);
  });

  function undo(): T | null {
    const entry = latest();
    if (!entry) return null;
    clearTimeout(entry.timeoutId);
    setQueued(q => q.filter(e => e !== entry));
    settle();
    return entry.item;
  }

  function queueAll(items: T[]) {
    const group = {};
    for (const item of items) queue(item, group);
  }

  // The most recent send and those queued with it
  function pendingGroup(): T[] {
    const group = latest()?.group;
    return group ? queued().filter(e => e.group === group).map(e => e.item) : [];
  }

  function undoAll(): T[] {
    const group = latest()?.group;
    if (!group) return [];
    const entries = queued().filter(e => e.group === group);
    for (const entry of entries) clearTimeout(entry.timeoutId);
    setQueued(q => q.filter(e => e.group !== group));
    settle();
    return entries.map(e => e.item);
  }

  return {
    queue: (item: T) => queue(item),
    queueAll,
    undo,
    undoAll,
    pending: () => latest()?.item ?? null,
    pendingGroup,
    progress,
    toastVisible,
    toastClosing,
  };
}
