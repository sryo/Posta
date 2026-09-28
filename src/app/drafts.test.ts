import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";

type Handler = (args: Record<string, unknown>) => unknown;
const handlers: Record<string, Handler> = {};
const invoke = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => handlers[cmd](args));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args) }));

import { createDraftSync, draftKey } from "./drafts";

const fields = (body: string) => ({ to: "bo@x.com", cc: "", bcc: "", subject: "Hi", body });
const sync = () => createRoot(() => createDraftSync());
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
  localStorage.clear();
  invoke.mockClear();
  for (const k of Object.keys(handlers)) delete handlers[k];
  handlers.delete_draft = () => null;
});

describe("draftKey", () => {
  it("keeps one draft per reply thread, one for forwards and one for new emails", () => {
    expect(draftKey("a", { replyThreadId: "t1" })).toBe("draft_reply_a_t1");
    expect(draftKey("a", { forwarding: true })).toBe("draft_forward_a");
    expect(draftKey("a", {})).toBe("draft_new_a");
  });
});

describe("createDraftSync", () => {
  it("saves locally and remembers the Gmail draft for the next save", async () => {
    handlers.save_draft = () => ({ id: "d1" });
    const drafts = sync();
    await drafts.save("k", "a", fields("one"));
    await drafts.save("k", "a", fields("two"));

    expect(invoke).toHaveBeenNthCalledWith(1, "save_draft", expect.objectContaining({ draftId: null, body: "one" }));
    expect(invoke).toHaveBeenNthCalledWith(2, "save_draft", expect.objectContaining({ draftId: "d1", body: "two" }));
    expect(JSON.parse(localStorage.getItem("k")!)).toMatchObject({ body: "two", gmailDraftId: "d1" });
  });

  it("does not save an empty draft", async () => {
    handlers.save_draft = () => ({ id: "d1" });
    const drafts = sync();
    await drafts.save("k", "a", { to: "", cc: "", bcc: "", subject: "", body: "" });
    expect(invoke).not.toHaveBeenCalled();
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("creates one Gmail draft when a second save starts before the first returns", async () => {
    const first = deferred<{ id: string }>();
    let calls = 0;
    handlers.save_draft = () => (calls++ === 0 ? first.promise : { id: "d1" });
    const drafts = sync();
    const a = drafts.save("k", "a", fields("one"));
    const b = drafts.save("k", "a", fields("two"));
    first.resolve({ id: "d1" });
    await Promise.all([a, b]);

    expect(invoke).toHaveBeenNthCalledWith(2, "save_draft", expect.objectContaining({ draftId: "d1", body: "two" }));
  });

  it("deletes the Gmail draft a save created after the draft was cleared", async () => {
    const pending = deferred<{ id: string }>();
    handlers.save_draft = () => pending.promise;
    const drafts = sync();
    const saving = drafts.save("k", "a", fields("one"));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("save_draft", expect.anything()));
    await drafts.clear("k", "a");
    pending.resolve({ id: "d9" });
    await saving;

    expect(invoke).toHaveBeenCalledWith("delete_draft", { accountId: "a", draftId: "d9" });
    expect(localStorage.getItem("k")).toBeNull();
    expect(drafts.gmailDraftId()).toBeNull();
  });

  it("deletes an existing Gmail draft once when it is cleared during an update", async () => {
    const create = deferred<{ id: string }>();
    const update = deferred<{ id: string }>();
    let calls = 0;
    handlers.save_draft = () => (calls++ === 0 ? create.promise : update.promise);
    const drafts = sync();
    drafts.save("k", "a", fields("one"));
    const saving = drafts.save("k", "a", fields("two"));
    create.resolve({ id: "d1" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    await drafts.clear("k", "a");
    update.resolve({ id: "d1" });
    await saving;

    expect(invoke.mock.calls.filter(([cmd]) => cmd === "delete_draft")).toEqual([["delete_draft", { accountId: "a", draftId: "d1" }]]);
  });

  it("does not hand the old compose's Gmail draft to the compose that replaced it", async () => {
    const pending = deferred<{ id: string }>();
    handlers.save_draft = () => pending.promise;
    const drafts = sync();
    const saving = drafts.save("k", "a", fields("old"));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("save_draft", expect.anything()));
    drafts.detach();
    pending.resolve({ id: "d-old" });
    await saving;

    expect(drafts.gmailDraftId()).toBeNull();
    // The replaced compose's draft is kept, not deleted
    expect(invoke).not.toHaveBeenCalledWith("delete_draft", expect.anything());
    expect(JSON.parse(localStorage.getItem("k")!)).toMatchObject({ body: "old" });
  });

  it("keeps the newer local text when an earlier save returns after it", async () => {
    const first = deferred<{ id: string }>();
    let calls = 0;
    handlers.save_draft = () => {
      if (calls++ === 0) return first.promise;
      throw new Error("offline");
    };
    const drafts = sync();
    const a = drafts.save("k", "a", fields("one"));
    vi.setSystemTime(Date.now() + 1000);
    const b = drafts.save("k", "a", fields("two"));
    first.resolve({ id: "d1" });
    await Promise.all([a, b]);
    vi.useRealTimers();

    expect(JSON.parse(localStorage.getItem("k")!)).toMatchObject({ body: "two", gmailDraftId: "d1" });
  });

  it("does not overwrite the replacing compose's draft saved under the same key", async () => {
    const pending = deferred<{ id: string }>();
    let calls = 0;
    handlers.save_draft = () => {
      if (calls++ === 0) return pending.promise;
      throw new Error("offline");
    };
    const drafts = sync();
    const saving = drafts.save("k", "a", fields("old"));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("save_draft", expect.anything()));
    drafts.detach();
    vi.setSystemTime(Date.now() + 1000);
    const next = drafts.save("k", "a", fields("new"));
    pending.resolve({ id: "d-old" });
    await Promise.all([saving, next]);
    vi.useRealTimers();

    expect(JSON.parse(localStorage.getItem("k")!)).toMatchObject({ body: "new" });
    expect(JSON.parse(localStorage.getItem("k")!).gmailDraftId).toBeUndefined();
  });

  it("clears the local copy and the Gmail draft", async () => {
    handlers.save_draft = () => ({ id: "d1" });
    const drafts = sync();
    await drafts.save("k", "a", fields("one"));
    await drafts.clear("k", "a");

    expect(invoke).toHaveBeenCalledWith("delete_draft", { accountId: "a", draftId: "d1" });
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("keeps the local copy when Gmail can't be reached", async () => {
    handlers.save_draft = () => { throw new Error("offline"); };
    const drafts = sync();
    await drafts.save("k", "a", fields("one"));
    expect(JSON.parse(localStorage.getItem("k")!)).toMatchObject({ body: "one" });
    expect(drafts.saved()).toBe(true);
  });

  it("restores a saved draft and updates its Gmail draft from then on", async () => {
    localStorage.setItem("k", JSON.stringify({ ...fields("saved"), gmailDraftId: "d5", savedAt: 1 }));
    handlers.save_draft = () => ({ id: "d5" });
    const drafts = sync();
    expect(drafts.load("k")).toMatchObject({ body: "saved" });
    await drafts.save("k", "a", fields("edited"));
    expect(invoke).toHaveBeenCalledWith("save_draft", expect.objectContaining({ draftId: "d5" }));
  });

  it("ignores a corrupt saved draft", () => {
    localStorage.setItem("k", "{");
    expect(sync().load("k")).toBeNull();
  });
});
