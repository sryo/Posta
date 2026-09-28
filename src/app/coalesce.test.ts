import { describe, expect, it } from "vitest";
import { coalesceByKey } from "./coalesce";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};

describe("coalesceByKey", () => {
  it("runs a request made while one is in flight once, after it", async () => {
    const runs: { key: string; done: ReturnType<typeof deferred> }[] = [];
    const refresh = coalesceByKey((key: string) => {
      const done = deferred();
      runs.push({ key, done });
      return done.promise;
    });

    const first = refresh("a");
    const second = refresh("a");
    const third = refresh("a");
    expect(runs).toHaveLength(1);

    runs[0].done.resolve();
    await new Promise(r => setTimeout(r, 0));
    expect(runs).toHaveLength(2);
    runs[1].done.resolve();
    await Promise.all([first, second, third]);
    expect(runs).toHaveLength(2);
  });

  it("runs different keys independently", () => {
    const keys: string[] = [];
    const refresh = coalesceByKey((key: string) => { keys.push(key); return new Promise<void>(() => {}); });
    refresh("a");
    refresh("b");
    expect(keys).toEqual(["a", "b"]);
  });

  it("runs again after a failed run", async () => {
    let calls = 0;
    const refresh = coalesceByKey(async () => { calls++; throw new Error("offline"); });
    await expect(refresh("a")).rejects.toThrow("offline");
    await expect(refresh("a")).rejects.toThrow("offline");
    expect(calls).toBe(2);
  });
});
