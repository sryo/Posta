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
    vi.advanceTimersByTime(200);
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
    expect(message()).toBe("Couldn't archive 1 thread.");
    toasts.dismiss();
    vi.advanceTimersByTime(200);
    expect(toasts.current()).toBeNull();

    toasts.show({ message: "Couldn't send.", tone: "error", action: { label: "Retry", run: () => {} } });
    expect(toasts.current()?.durationMs).toBe(10000);
    vi.advanceTimersByTime(9999);
    expect(toasts.current()?.closing).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toasts.current()?.closing).toBe(true);
  });

  it("runs a toast's action once and closes it", () => {
    const run = vi.fn();
    toasts.show({ message: "Draft saved", action: { label: "Discard", run } });
    toasts.runAction();
    toasts.runAction();
    expect(run).toHaveBeenCalledTimes(1);
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
