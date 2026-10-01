import { createSignal, onCleanup } from "solid-js";
import { createUndoStack, type UndoEntry } from "./undoStack";

export type ToastTone = "info" | "error";

export interface ToastAction {
  label: string;
  run: () => void;
  // Its shortcut, shown beside it
  keys?: string;
}

export interface ToastInput {
  message: string;
  tone?: ToastTone;
  // Buttons besides Undo: Open, Discard, Retry
  action?: ToastAction | ToastAction[];
  // Makes it an undo toast, with an Undo button that z presses too, now or
  // later in the session. It may say what it did, as `undone` does.
  undo?: UndoEntry["undo"];
  // What undoing did: "Unarchived “Contract v3”"
  undone?: string;
  // Does it again after an undo; without it ⇧Z can't
  redo?: () => void;
  // Runs when the toast goes without its Undo: commits a change held back
  // until then
  onExpire?: () => void;
  // Lets whoever showed it close it again
  tag?: string;
  // A second line: what the next z will undo
  note?: string;
}

export function toastActions(toast: ToastInput): ToastAction[] {
  return toast.action ? [toast.action].flat() : [];
}

export interface ShownToast extends ToastInput {
  id: number;
  closing: boolean;
  paused: boolean;
  // How long it shows; null keeps it until dismissed
  durationMs: number | null;
}

// One place on screen that shows a toast at a time, with its timer
function createSlot(durationFor: (input: ToastInput) => number | null, closeMs: number, nextId: () => number) {
  const [current, setCurrent] = createSignal<ShownToast | null>(null);
  const queue: ToastInput[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let remainingMs = 0;
  let startedAt = 0;
  // Whether the shown toast's onExpire is still to run
  let pendingExpire: (() => void) | undefined;

  function startTimer(ms: number) {
    clearTimeout(timer);
    remainingMs = ms;
    startedAt = Date.now();
    timer = setTimeout(() => close(true), ms);
  }

  function display(input: ToastInput) {
    clearTimeout(timer);
    clearTimeout(closeTimer);
    pendingExpire = input.onExpire;
    const toast: ShownToast = { ...input, id: nextId(), closing: false, paused: false, durationMs: durationFor(input) };
    setCurrent(toast);
    if (toast.durationMs !== null) startTimer(toast.durationMs);
  }

  // Ends the shown toast; `expire` commits its held change
  function close(expire: boolean) {
    const toast = current();
    if (!toast || toast.closing) return;
    clearTimeout(timer);
    const commit = expire ? pendingExpire : undefined;
    pendingExpire = undefined;
    setCurrent({ ...toast, closing: true });
    commit?.();
    closeTimer = setTimeout(() => {
      setCurrent(null);
      const next = queue.shift();
      if (next) display(next);
    }, closeMs);
  }

  function show(input: ToastInput) {
    const shown = current();
    if (shown && !shown.closing && shown.undo && !input.undo) {
      queue.push(input);
      return;
    }
    if (shown && !shown.closing) {
      const commit = pendingExpire;
      pendingExpire = undefined;
      commit?.();
    }
    display(input);
  }

  // Closes an undo toast without committing its change, which is being undone
  function closeForUndo() {
    const toast = current();
    if (toast && !toast.closing && toast.undo) close(false);
  }

  function runAction(index: number) {
    const toast = current();
    const action = toast && toastActions(toast)[index];
    if (!toast || toast.closing || !action) return;
    const { run } = action;
    close(true);
    run();
  }

  function pause() {
    const toast = current();
    if (!toast || toast.closing || toast.paused) return;
    clearTimeout(timer);
    if (toast.durationMs !== null) remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
    setCurrent({ ...toast, paused: true });
  }

  function resume() {
    const toast = current();
    if (!toast || toast.closing || !toast.paused) return;
    setCurrent({ ...toast, paused: false });
    if (toast.durationMs !== null) startTimer(remainingMs);
  }

  onCleanup(() => {
    clearTimeout(timer);
    clearTimeout(closeTimer);
  });

  return { current, show, closeForUndo, runAction, pause, resume, close };
}

type Slot = ReturnType<typeof createSlot>;

// Information and undo toasts show one at a time. An undo toast is never cut
// short by an info toast, which waits for it instead; a newer undo toast
// takes over and commits the change of the one it replaces. An error shows
// at once, raised over whatever toast is already showing, and replaces only
// an earlier error.
// Each undo toast's change joins the session's undo stack, which z walks
// back through after its toast has gone, and ⇧Z forward again. A change held
// until its toast goes (onExpire) leaves the stack once committed.
export function createToasts({ infoMs = 5000, errorMs = 10000, closeMs = 200 } = {}) {
  let lastId = 0;
  const nextId = () => ++lastId;
  const info = createSlot(() => infoMs, closeMs, nextId);
  // An error stays until dismissed, unless it offers to try again
  const errors = createSlot((input) => (input.action ? errorMs : null), closeMs, nextId);

  // The slot showing toast `id`; the info slot when none is given
  const slotOf = (id?: number): Slot | null => {
    if (id === undefined) return info;
    if (info.current()?.id === id) return info;
    if (errors.current()?.id === id) return errors;
    return null;
  };

  const stack = createUndoStack();

  function show(input: ToastInput) {
    if (!input.undo || input.tone === "error") return (input.tone === "error" ? errors : info).show(input);
    const entry: UndoEntry = { label: input.message, undo: input.undo, undone: input.undone, redo: input.redo, tag: input.tag };
    stack.push(entry);
    const commit = input.onExpire;
    info.show({ ...input, onExpire: commit && (() => { stack.drop(entry); commit(); }) });
  }

  // The undo toast of the latest change, with Undo taking it off the stack
  const showLatest = (input: Omit<ToastInput, "undo">) =>
    info.show({ ...input, undo: stack.canUndo() ? () => {} : undefined });

  function undo(): boolean {
    if (!stack.canUndo()) return false;
    info.closeForUndo();
    const result = stack.undo()!;
    const next = stack.peek();
    showLatest({
      message: result.message,
      note: next ? `z next: ${next.label}` : "Nothing earlier to undo this session",
      action: stack.canRedo() ? { label: "Redo", keys: "⇧Z", run: () => { redo(); } } : undefined,
    });
    return true;
  }

  function redo(): boolean {
    const entry = stack.redo();
    if (!entry) return false;
    showLatest({ message: entry.label, tag: entry.tag });
    return true;
  }

  return {
    current: info.current,
    error: errors.current,
    show,
    undo,
    redo,
    canUndo: stack.canUndo,
    canRedo: stack.canRedo,
    runAction: (index = 0, id?: number) => slotOf(id)?.runAction(index),
    pause: (id?: number) => slotOf(id)?.pause(),
    resume: (id?: number) => slotOf(id)?.resume(),
    dismiss: (id?: number) => slotOf(id)?.close(true),
    dismissTag: (tag: string) => {
      for (const slot of [info, errors]) if (slot.current()?.tag === tag) slot.close(true);
      stack.dropTag(tag);
    },
    hasUndo: () => { const t = info.current(); return !!t && !t.closing && !!t.undo; },
  };
}
