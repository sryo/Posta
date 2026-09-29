import { afterEach, describe, expect, it, vi } from "vitest";
import { pullLayoutWithRetry } from "./icloudRestore";

afterEach(() => vi.useRealTimers());

describe("pullLayoutWithRetry", () => {
  it("pulls once when the first pull finds a layout", async () => {
    vi.useFakeTimers();
    const pull = vi.fn(async () => true);
    const done = pullLayoutWithRetry(pull);
    await vi.advanceTimersByTimeAsync(500);
    await done;
    expect(pull).toHaveBeenCalledTimes(1);
  });

  it("retries once, after a longer wait, when the first pull finds nothing", async () => {
    vi.useFakeTimers();
    const pull = vi.fn(async () => false);
    const done = pullLayoutWithRetry(pull);
    await vi.advanceTimersByTimeAsync(499);
    expect(pull).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(pull).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(pull).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(pull).toHaveBeenCalledTimes(2);
  });

  it("says whether either pull found a layout", async () => {
    vi.useFakeTimers();
    const found = pullLayoutWithRetry(vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true));
    const missing = pullLayoutWithRetry(vi.fn(async () => false));
    await vi.advanceTimersByTimeAsync(1500);
    expect(await found).toBe(true);
    expect(await missing).toBe(false);
  });
});
