import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import { createToasts } from "./toasts";

let dispose: () => void;
let toasts: ReturnType<typeof createToasts>;

beforeEach(() => {
  vi.useFakeTimers();
  createRoot(d => {
    dispose = d;
    toasts = createToasts({ infoMs: 5000, errorMs: 10000, closeMs: 200 });
  });
});

afterEach(() => {
  dispose();
  vi.useRealTimers();
});

const message = () => toasts.current()?.message ?? null;

describe("toasts", () => {
  it("shows a toast for its time, then closes it", () => {
    toasts.show({ message: "Saved" });
    expect(message()).toBe("Saved");
    vi.advanceTimersByTime(4999);
    expect(toasts.current()?.closing).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toasts.current()?.closing).toBe(true);
    vi.advanceTimersByTime(200);
    expect(toasts.current()).toBeNull();
  });

  it("replaces an info toast with the next one straight away", () => {
    toasts.show({ message: "One" });
    toasts.show({ message: "Two" });
    expect(message()).toBe("Two");
  });

  it("keeps an undo toast up when an info toast arrives, showing the info after it", () => {
    const undo = vi.fn();
    toasts.show({ message: "Archived 1 thread", undo });
    toasts.show({ message: "Reply sent" });
    expect(message()).toBe("Archived 1 thread");
    expect(toasts.undo()).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5200);
    expect(message()).toBe("Reply sent");
  });

  it("commits an undoable change when its toast goes without Undo", () => {
    const onExpire = vi.fn();
    const undo = vi.fn();
    toasts.show({ message: "Deleted card", undo, onExpire });
    vi.advanceTimersByTime(5200);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
    expect(toasts.undo()).toBe(false);
  });

  it("commits the earlier undoable change when a newer one takes its toast", () => {
    const first = vi.fn();
    toasts.show({ message: "Deleted card", undo: () => {}, onExpire: first });
    toasts.show({ message: "Archived 1 thread", undo: () => {} });
    expect(first).toHaveBeenCalledTimes(1);
    expect(message()).toBe("Archived 1 thread");
  });

  it("does not commit a change that was undone", () => {
    const onExpire = vi.fn();
    toasts.show({ message: "Deleted card", undo: () => {}, onExpire });
    toasts.undo();
    vi.advanceTimersByTime(10000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("pauses its timer while hovered or focused", () => {
    toasts.show({ message: "Saved" });
    vi.advanceTimersByTime(3000);
    toasts.pause();
    expect(toasts.current()?.paused).toBe(true);
    vi.advanceTimersByTime(10000);
    expect(toasts.current()?.closing).toBe(false);
    toasts.resume();
    vi.advanceTimersByTime(1999);
    expect(toasts.current()?.closing).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toasts.current()?.closing).toBe(true);
  });

  it("keeps an error until it is dismissed, or for longer when it offers to retry", () => {
    toasts.show({ message: "Couldn't archive 1 thread.", tone: "error" });
    vi.advanceTimersByTime(60000);
    expect(toasts.error()?.message).toBe("Couldn't archive 1 thread.");
    toasts.dismiss(toasts.error()!.id);
    vi.advanceTimersByTime(200);
    expect(toasts.error()).toBeNull();

    toasts.show({ message: "Couldn't send.", tone: "error", action: { label: "Retry", run: () => {} } });
    expect(toasts.error()?.durationMs).toBe(10000);
    vi.advanceTimersByTime(9999);
    expect(toasts.error()?.closing).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toasts.error()?.closing).toBe(true);
  });

  it("shows an error at once beside an undo toast, which keeps its Undo and its time", () => {
    const undo = vi.fn();
    const onExpire = vi.fn();
    toasts.show({ message: "Deleted card", undo, onExpire });
    vi.advanceTimersByTime(1000);
    toasts.show({ message: "Couldn't archive 1 thread.", tone: "error" });
    expect(toasts.error()?.message).toBe("Couldn't archive 1 thread.");
    expect(message()).toBe("Deleted card");
    expect(onExpire).not.toHaveBeenCalled();
    expect(toasts.hasUndo()).toBe(true);
    vi.advanceTimersByTime(3999);
    expect(toasts.current()?.closing).toBe(false);
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(toasts.error()?.message).toBe("Couldn't archive 1 thread.");
  });

  it("replaces a shown error with a newer one, leaving the other toast alone", () => {
    toasts.show({ message: "Reply sent" });
    toasts.show({ message: "Couldn't star 1 thread.", tone: "error" });
    toasts.show({ message: "Couldn't archive 1 thread.", tone: "error" });
    expect(toasts.error()?.message).toBe("Couldn't archive 1 thread.");
    expect(message()).toBe("Reply sent");
  });

  it("runs, pauses and dismisses the toast it is given by id", () => {
    const retry = vi.fn();
    toasts.show({ message: "Reply sent" });
    toasts.show({ message: "Couldn't send.", tone: "error", action: { label: "Retry", run: retry } });
    const errorId = toasts.error()!.id;
    toasts.pause(errorId);
    expect(toasts.error()?.paused).toBe(true);
    expect(toasts.current()?.paused).toBe(false);
    toasts.runAction(0, errorId);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(toasts.error()?.closing).toBe(true);
    expect(toasts.current()?.closing).toBe(false);
  });

  it("runs a toast's action once and closes it", () => {
    const run = vi.fn();
    toasts.show({ message: "Draft saved", action: { label: "Discard", run } });
    toasts.runAction();
    toasts.runAction();
    expect(run).toHaveBeenCalledTimes(1);
    expect(toasts.current()?.closing).toBe(true);
  });

  it("runs the chosen one of several actions", () => {
    const open = vi.fn();
    const discard = vi.fn();
    toasts.show({ message: "Draft saved", action: [{ label: "Open", run: open }, { label: "Discard", run: discard }] });
    toasts.runAction(1);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(toasts.current()?.closing).toBe(true);
  });

  it("closes a tagged toast by its tag only", () => {
    toasts.show({ message: "Draft saved", tag: "draft:1" });
    toasts.dismissTag("draft:2");
    expect(toasts.current()?.closing).toBe(false);
    toasts.dismissTag("draft:1");
    expect(toasts.current()?.closing).toBe(true);
  });
});

describe("undo through the session", () => {
  const archive = (subject: string) => ({ message: `Archived “${subject}”`, undone: `Unarchived “${subject}”`, undo: vi.fn(), redo: vi.fn() });

  it("undoes an earlier action after its toast has gone, newest first", () => {
    const one = archive("One");
    const two = archive("Two");
    toasts.show(one);
    toasts.show(two);
    vi.advanceTimersByTime(10000);
    expect(toasts.current()).toBeNull();

    expect(toasts.canUndo()).toBe(true);
    expect(toasts.undo()).toBe(true);
    expect(two.undo).toHaveBeenCalledTimes(1);
    expect(toasts.undo()).toBe(true);
    expect(one.undo).toHaveBeenCalledTimes(1);
    expect(toasts.canUndo()).toBe(false);
    expect(toasts.undo()).toBe(false);
  });

  it("says what it undid and what the next z will undo", () => {
    toasts.show(archive("One"));
    toasts.show(archive("Two"));
    toasts.undo();
    expect(message()).toBe("Unarchived “Two”");
    expect(toasts.current()?.note).toBe("z next: Archived “One”");
    toasts.undo();
    expect(message()).toBe("Unarchived “One”");
    expect(toasts.current()?.note).toBe("Nothing earlier to undo this session");
  });

  it("redoes the last undone action, offering to undo it again", () => {
    const one = archive("One");
    toasts.show(one);
    toasts.undo();
    expect(toasts.canRedo()).toBe(true);
    expect(toasts.redo()).toBe(true);
    expect(one.redo).toHaveBeenCalledTimes(1);
    expect(message()).toBe("Archived “One”");
    expect(toasts.current()?.undo).toBeTruthy();
    expect(toasts.redo()).toBe(false);
    toasts.undo();
    expect(one.undo).toHaveBeenCalledTimes(2);
  });

  it("offers Redo on the toast saying what was undone", () => {
    const one = archive("One");
    toasts.show(one);
    toasts.undo();
    expect(toasts.current()?.action).toEqual(expect.objectContaining({ label: "Redo" }));
    toasts.runAction();
    expect(one.redo).toHaveBeenCalledTimes(1);
  });

  it("can't undo a held change once its toast committed it", () => {
    const older = archive("One");
    const undoDelete = vi.fn();
    toasts.show(older);
    toasts.show({ message: "Deleted “Planning”", undo: undoDelete, onExpire: () => {} });
    vi.advanceTimersByTime(10000);
    toasts.undo();
    expect(undoDelete).not.toHaveBeenCalled();
    expect(older.undo).toHaveBeenCalledTimes(1);
  });

  it("forgets the actions of an account signed out of", () => {
    const one = { ...archive("One"), tag: "account:a" };
    toasts.show(one);
    vi.advanceTimersByTime(10000);
    toasts.dismissTag("account:a");
    expect(toasts.canUndo()).toBe(false);
  });
});
