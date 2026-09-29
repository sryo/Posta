import { createSignal, onCleanup } from "solid-js";

export type ToastTone = "info" | "error";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastInput {
  message: string;
  tone?: ToastTone;
  // A button besides Undo: Open, Discard, Retry
  action?: ToastAction;
  // Makes it an undo toast, with an Undo button that z presses too
  undo?: () => void;
  // Runs when the toast goes without its Undo: commits a change held back
  // until then
  onExpire?: () => void;
  // Lets whoever showed it close it again
  tag?: string;
}

export interface ShownToast extends ToastInput {
  id: number;
  closing: boolean;
  paused: boolean;
  // How long it shows; null keeps it until dismissed
  durationMs: number | null;
}

// One toast at a time. An undo toast is never cut short by an info toast,
// which waits for it instead; a newer undo toast takes over and commits the
// change of the one it replaces.
export function createToasts({ infoMs = 5000, errorMs = 10000, closeMs = 200 } = {}) {
  const [current, setCurrent] = createSignal<ShownToast | null>(null);
  const queue: ToastInput[] = [];
  let nextId = 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let remainingMs = 0;
  let startedAt = 0;
  // Whether the shown toast's onExpire is still to run
  let pendingExpire: (() => void) | undefined;

  const durationFor = (input: ToastInput): number | null => {
    if (input.tone !== "error") return infoMs;
    // An error stays until dismissed, unless it offers to try again
    return input.action ? errorMs : null;
  };

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
    const toast: ShownToast = { ...input, id: nextId++, closing: false, paused: false, durationMs: durationFor(input) };
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

  function undo(): boolean {
    const toast = current();
    if (!toast || toast.closing || !toast.undo) return false;
    const run = toast.undo;
    close(false);
    run();
    return true;
  }

  function runAction() {
    const toast = current();
    if (!toast || toast.closing || !toast.action) return;
    const { run } = toast.action;
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

  return {
    current,
    show,
    undo,
    runAction,
    pause,
    resume,
    dismiss: () => close(true),
    dismissTag: (tag: string) => { if (current()?.tag === tag) close(true); },
    hasUndo: () => { const t = current(); return !!t && !t.closing && !!t.undo; },
  };
}
