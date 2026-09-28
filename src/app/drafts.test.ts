import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";

type Handler = (args: Record<string, unknown>) => unknown;
const handlers: Record<string, Handler> = {};
const invoke = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => handlers[cmd](args));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args) }));

import { createDraftSync, draftKey, findLatestDraft, markDraftClosed, pruneDrafts, removeAccountDrafts, sessionDraftKey } from "./drafts";

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
  it("groups drafts by what the compose replies to or forwards", () => {
    expect(draftKey("a", { replyThreadId: "t1" })).toBe("draft_reply_a_t1");
    expect(draftKey("a", { forwardThreadId: "t1" })).toBe("draft_forward_a_t1");
    expect(draftKey("a", { replyEventId: "e1" })).toBe("draft_eventreply_a_e1");
    expect(draftKey("a", { forwardEventId: "e1" })).toBe("draft_eventforward_a_e1");
    expect(draftKey("a", {})).toBe("draft_new_a");
  });

  it("gives every compose its own key under the group", () => {
    const one = sessionDraftKey("draft_new_a");
    const two = sessionDraftKey("draft_new_a");
    expect(one).not.toBe(two);
    expect(one.startsWith("draft_new_a#")).toBe(true);
  });
});

describe("findLatestDraft", () => {
  const store = (key: string, body: string, savedAt: number) =>
    localStorage.setItem(key, JSON.stringify({ ...fields(body), savedAt }));

  it("picks the most recently saved draft of the group", () => {
    store("draft_new_a#1", "older", 1);
    store("draft_new_a#2", "newer", 2);
    store("draft_new_ab#3", "other account", 3);
    store("draft_reply_a_t1#4", "a reply", 4);
    expect(findLatestDraft("draft_new_a")).toMatchObject({ key: "draft_new_a#2", draft: { body: "newer" } });
  });

  it("finds a draft saved under the key earlier versions used", () => {
    store("draft_new_a", "legacy", 1);
    expect(findLatestDraft("draft_new_a")).toMatchObject({ key: "draft_new_a", draft: { body: "legacy" } });
  });

  it("finds nothing when the group has no draft", () => {
    localStorage.setItem("draft_new_a#1", "{");
    expect(findLatestDraft("draft_new_a")).toBeNull();
  });
});

describe("removeAccountDrafts", () => {
  it("removes every local draft of the account and nothing else", () => {
    for (const key of ["draft_new_a", "draft_new_a#1", "draft_reply_a_t1#2", "draft_forward_a", "draft_eventreply_a_e1#3"]) {
      localStorage.setItem(key, "{}");
    }
    localStorage.setItem("draft_new_ab#1", "{}");
    localStorage.setItem("draft_reply_b_t1", "{}");
    localStorage.setItem("cardWidth", "300");
    removeAccountDrafts("a");
    expect(Object.keys(localStorage).sort()).toEqual(["cardWidth", "draft_new_ab#1", "draft_reply_b_t1"]);
  });
});

describe("pruneDrafts", () => {
  const DAY = 86400000;
  const now = 100 * DAY;
  const store = (key: string, draft: Record<string, unknown>) =>
    localStorage.setItem(key, JSON.stringify({ ...fields("x"), savedAt: now, ...draft }));

  it("removes closed new emails that Gmail's Drafts already holds", () => {
    store("draft_new_a#1", { closed: true, gmailDraftId: "d1" });
    pruneDrafts(now);
    expect(localStorage.getItem("draft_new_a#1")).toBeNull();
  });

  it("keeps a closed reply in Gmail for a month so replying again picks it up", () => {
    store("draft_reply_a_t1#1", { closed: true, gmailDraftId: "d1", savedAt: now - 29 * DAY });
    store("draft_reply_a_t2#1", { closed: true, gmailDraftId: "d2", savedAt: now - 31 * DAY });
    pruneDrafts(now);
    expect(localStorage.getItem("draft_reply_a_t1#1")).not.toBeNull();
    expect(localStorage.getItem("draft_reply_a_t2#1")).toBeNull();
  });

  it("keeps every draft that is the only copy, however old", () => {
    store("draft_new_a#1", { closed: true, savedAt: 0 });
    store("draft_new_a#2", { savedAt: 0, gmailDraftId: "d2" });
    store("draft_reply_a_t1#1", { closed: true, savedAt: 0 });
    store("draft_new_a#3", { closed: true, gmailDraftId: "d3", sending: true });
    localStorage.setItem("draft_new_a#4", "{");
    localStorage.setItem("cardWidth", "300");
    pruneDrafts(now);
    expect(Object.keys(localStorage).sort()).toEqual(["cardWidth", "draft_new_a#1", "draft_new_a#2", "draft_new_a#3", "draft_new_a#4", "draft_reply_a_t1#1"]);
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

  it("records the Gmail draft on the replaced compose's key even after newer local text", async () => {
    const pending = deferred<{ id: string }>();
    handlers.save_draft = () => pending.promise;
    const drafts = sync();
    const saving = drafts.save("k", "a", fields("old"));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("save_draft", expect.anything()));
    vi.setSystemTime(Date.now() + 1000);
    drafts.saveLocal("k", fields("newer"));
    drafts.detach();
    pending.resolve({ id: "d-old" });
    await saving;
    vi.useRealTimers();

    expect(JSON.parse(localStorage.getItem("k")!)).toMatchObject({ body: "newer", gmailDraftId: "d-old" });
  });

  it("deletes the Gmail draft a replaced compose's save created after its draft was discarded", async () => {
    const pending = deferred<{ id: string }>();
    handlers.save_draft = () => pending.promise;
    const drafts = sync();
    const saving = drafts.save("k", "a", fields("old"));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("save_draft", expect.anything()));
    drafts.detach();
    const discarding = drafts.discard("k", "a");
    pending.resolve({ id: "d-old" });
    await Promise.all([saving, discarding]);

    expect(invoke).toHaveBeenCalledWith("delete_draft", { accountId: "a", draftId: "d-old" });
    expect(localStorage.getItem("k")).toBeNull();
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

  it("doesn't claim the draft is saved when neither Gmail nor local storage took it", async () => {
    handlers.save_draft = () => { throw new Error("offline"); };
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    try {
      const drafts = sync();
      await drafts.save("k", "a", fields("one"));
      expect(drafts.saved()).toBe(false);
    } finally {
      setItem.mockRestore();
    }
  });

  describe("when local storage refuses the draft", () => {
    const refuseStorage = () => vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });

    it("still syncs a save made just before the compose let go", async () => {
      handlers.save_draft = () => ({ id: "d1" });
      const setItem = refuseStorage();
      try {
        const drafts = sync();
        const last = drafts.save("k", "a", fields("only copy"));
        drafts.detach();
        expect(await last).toBe(true);
        expect(invoke).toHaveBeenCalledWith("save_draft", expect.objectContaining({ body: "only copy" }));
      } finally {
        setItem.mockRestore();
      }
    });

    it("reports a save that reached neither Gmail nor local storage", async () => {
      handlers.save_draft = () => { throw new Error("offline"); };
      const setItem = refuseStorage();
      try {
        const drafts = sync();
        const last = drafts.save("k", "a", fields("lost"));
        drafts.detach();
        expect(await last).toBe(false);
      } finally {
        setItem.mockRestore();
      }
    });

    it("discards the Gmail draft it synced to", async () => {
      handlers.save_draft = () => ({ id: "d1" });
      const setItem = refuseStorage();
      try {
        const drafts = sync();
        const last = drafts.save("k", "a", fields("only copy"));
        drafts.detach();
        await last;
        await drafts.discard("k", "a");
        expect(invoke).toHaveBeenCalledWith("delete_draft", { accountId: "a", draftId: "d1" });
      } finally {
        setItem.mockRestore();
      }
    });
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

  it("syncs a save made just before the compose let go, updating that compose's Gmail draft", async () => {
    handlers.save_draft = ({ draftId }) => ({ id: draftId ?? "d1" });
    const drafts = sync();
    await drafts.save("k", "a", fields("one"));
    const last = drafts.save("k", "a", fields("two"));
    drafts.detach();
    await last;

    expect(invoke).toHaveBeenLastCalledWith("save_draft", expect.objectContaining({ draftId: "d1", body: "two" }));
    expect(JSON.parse(localStorage.getItem("k")!)).toMatchObject({ body: "two", gmailDraftId: "d1" });
    expect(drafts.gmailDraftId()).toBeNull();
  });

  it("reopens a closed draft for restoring when it could not reach Gmail", async () => {
    handlers.save_draft = () => { throw new Error("offline"); };
    const drafts = sync();
    const saving = drafts.save("k", "a", fields("one"));
    markDraftClosed("k");
    drafts.detach();
    await saving;

    expect(JSON.parse(localStorage.getItem("k")!).closed).toBe(false);
  });

  it("keeps a closed draft closed once it is in Gmail", async () => {
    handlers.save_draft = () => ({ id: "d1" });
    const drafts = sync();
    const saving = drafts.save("k", "a", fields("one"));
    markDraftClosed("k");
    drafts.detach();
    await saving;

    expect(JSON.parse(localStorage.getItem("k")!)).toMatchObject({ closed: true, gmailDraftId: "d1" });
  });

  it("does not sync a save whose draft was cleared before it ran", async () => {
    handlers.save_draft = () => ({ id: "d1" });
    const drafts = sync();
    const saving = drafts.save("k", "a", fields("one"));
    await drafts.clear("k", "a");
    await saving;

    expect(invoke).not.toHaveBeenCalledWith("save_draft", expect.anything());
  });

  it("saves locally at once without contacting Gmail", () => {
    handlers.save_draft = () => ({ id: "d1" });
    const drafts = sync();
    drafts.saveLocal("k", fields("typed"));
    expect(JSON.parse(localStorage.getItem("k")!)).toMatchObject({ body: "typed" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the Gmail draft id when saving locally", async () => {
    handlers.save_draft = () => ({ id: "d1" });
    const drafts = sync();
    await drafts.save("k", "a", fields("one"));
    drafts.saveLocal("k", fields("two"));
    expect(JSON.parse(localStorage.getItem("k")!)).toMatchObject({ body: "two", gmailDraftId: "d1" });
  });

  it("discards a detached compose's draft locally and in Gmail", async () => {
    handlers.save_draft = () => ({ id: "d1" });
    const drafts = sync();
    await drafts.save("k", "a", fields("one"));
    drafts.detach();
    await drafts.discard("k", "a");

    expect(invoke).toHaveBeenCalledWith("delete_draft", { accountId: "a", draftId: "d1" });
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("adopts the new Gmail draft the backend made when the one it was updating is gone", async () => {
    localStorage.setItem("k", JSON.stringify({ ...fields("saved"), gmailDraftId: "gone", savedAt: 1 }));
    handlers.save_draft = () => ({ id: "d2" });
    const drafts = sync();
    drafts.load("k");
    await drafts.save("k", "a", fields("edited"));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(drafts.gmailDraftId()).toBe("d2");
    expect(JSON.parse(localStorage.getItem("k")!)).toMatchObject({ body: "edited", gmailDraftId: "d2" });
  });
});
