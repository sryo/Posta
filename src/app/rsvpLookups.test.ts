import { describe, expect, it } from "vitest";
import { createRsvpLookups } from "./rsvpLookups";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe("createRsvpLookups", () => {
  it("looks each invite up once, however many rows ask", async () => {
    const calls: string[] = [];
    const found: Record<string, string> = {};
    const lookups = createRsvpLookups({
      lookup: async (accountId, uid) => { calls.push(`${accountId}/${uid}`); return "accepted"; },
      onStatus: (key, status) => { found[key] = status; },
    });
    lookups.request("a", "u1");
    lookups.request("a", "u1");
    await flush();
    lookups.request("a", "u1");
    await flush();
    expect(calls).toEqual(["a/u1"]);
    expect(found).toEqual({ [lookups.key("a", "u1")]: "accepted" });
  });

  it("runs a couple of lookups at a time", async () => {
    const pending = new Map<string, ReturnType<typeof deferred<string | null>>>();
    const lookups = createRsvpLookups({
      lookup: (_a, uid) => { const d = deferred<string | null>(); pending.set(uid, d); return d.promise; },
      onStatus: () => {},
      concurrency: 2,
    });
    for (const uid of ["u1", "u2", "u3", "u4"]) lookups.request("a", uid);
    await flush();
    expect([...pending.keys()]).toEqual(["u1", "u2"]);
    pending.get("u1")!.resolve(null);
    await flush();
    expect([...pending.keys()]).toEqual(["u1", "u2", "u3"]);
  });

  it("tries a failed lookup again when asked to retry", async () => {
    let fail = true;
    const found: string[] = [];
    let calls = 0;
    const lookups = createRsvpLookups({
      lookup: async () => { calls++; if (fail) throw new Error("offline"); return "declined"; },
      onStatus: (_k, status) => found.push(status),
    });
    lookups.request("a", "u1");
    await flush();
    lookups.request("a", "u1");
    await flush();
    expect(calls).toBe(1);

    fail = false;
    lookups.retryFailed();
    await flush();
    expect(calls).toBe(2);
    expect(found).toEqual(["declined"]);
  });
});
