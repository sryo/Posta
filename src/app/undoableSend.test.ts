import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import { createUndoableSend } from "./undoableSend";

const DELAY = 5000;

function setup() {
  const sent: string[] = [];
  const failed: string[] = [];
  let failNext = false;
  const sender = createUndoableSend<string>({
    delayMs: DELAY,
    send: async (item) => {
      if (failNext) {
        failNext = false;
        throw new Error("boom");
      }
      sent.push(item);
    },
    onFailed: (item) => failed.push(item),
  });
  return { sender, sent, failed, failOnce: () => { failNext = true; } };
}

describe("createUndoableSend", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends after the delay and then hides the toast", async () => {
    const { sender, sent } = setup();
    sender.queue("A");
    expect(sender.toastVisible()).toBe(true);
    expect(sender.pending()).toBe("A");

    await vi.advanceTimersByTimeAsync(DELAY - 1);
    expect(sent).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toEqual(["A"]);
    expect(sender.pending()).toBeNull();

    await vi.advanceTimersByTimeAsync(500);
    expect(sender.toastVisible()).toBe(false);
  });

  it("undo inside the window cancels the send and returns the item", async () => {
    const { sender, sent } = setup();
    sender.queue("A");
    await vi.advanceTimersByTimeAsync(2000);

    expect(sender.undo()).toBe("A");
    await vi.advanceTimersByTimeAsync(DELAY * 2);
    expect(sent).toEqual([]);
    expect(sender.toastVisible()).toBe(false);
  });

  it("undo after the window has passed is a no-op", async () => {
    const { sender, sent } = setup();
    sender.queue("A");
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(sender.undo()).toBeNull();
    expect(sent).toEqual(["A"]);
  });

  it("an earlier send completing does not take away the undo of a later one", async () => {
    const { sender, sent } = setup();
    sender.queue("A");
    await vi.advanceTimersByTimeAsync(2000);
    sender.queue("B");

    // A goes out at t=5000; B is still inside its own window until t=7000
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toEqual(["A"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(sender.pending()).toBe("B");
    expect(sender.toastVisible()).toBe(true);

    expect(sender.undo()).toBe("B");
    await vi.advanceTimersByTimeAsync(DELAY * 2);
    expect(sent).toEqual(["A"]);
  });

  it("undo only cancels the most recent send", async () => {
    const { sender, sent } = setup();
    sender.queue("A");
    sender.queue("B");
    expect(sender.undo()).toBe("B");
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(sent).toEqual(["A"]);
  });

  it("progress restarts for each queued send and reaches 100", async () => {
    const { sender } = setup();
    sender.queue("A");
    await vi.advanceTimersByTimeAsync(DELAY / 2);
    expect(sender.progress()).toBeGreaterThanOrEqual(45);
    expect(sender.progress()).toBeLessThanOrEqual(55);
    sender.queue("B");
    expect(sender.progress()).toBe(0);
    await vi.advanceTimersByTimeAsync(DELAY - 1);
    expect(sender.progress()).toBeGreaterThanOrEqual(95);
  });

  it("reports a failed send and still hides the toast", async () => {
    const { sender, sent, failed, failOnce } = setup();
    failOnce();
    sender.queue("A");
    await vi.advanceTimersByTimeAsync(DELAY + 500);
    expect(sent).toEqual([]);
    expect(failed).toEqual(["A"]);
    expect(sender.toastVisible()).toBe(false);
  });

  // Like a quit: the email's draft stays marked as being sent for the next start
  it("sends nothing queued once its owner is disposed", async () => {
    const sent: string[] = [];
    const dispose = createRoot(dispose => {
      const sender = createUndoableSend<string>({ delayMs: DELAY, send: async item => { sent.push(item); }, onFailed: () => {} });
      sender.queue("A");
      return dispose;
    });
    dispose();
    await vi.advanceTimersByTimeAsync(DELAY * 2);
    expect(sent).toEqual([]);
  });
});
