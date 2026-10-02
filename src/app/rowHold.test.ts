import { afterEach, describe, expect, it, vi } from "vitest";
import type { Thread, ThreadGroup } from "../api/tauri";
import { createNewMailHold, createPointerHold, holdIncoming, releaseHeld } from "./rowHold";

const t = (id: string, extra: Partial<Thread> = {}): Thread => ({
  gmail_thread_id: id, account_id: "a", subject: id, snippet: "", last_message_date: 0,
  unread_count: 0, labels: ["INBOX"], participants: [], has_attachment: false, attachments: [], calendar_event: null,
  ...extra,
});
const ids = (groups: ThreadGroup[]) => groups.map(g => `${g.label}: ${g.threads.map(x => x.gmail_thread_id).join(" ")}`);

describe("holdIncoming", () => {
  const shown: ThreadGroup[] = [{ label: "Today", threads: [t("a"), t("b")] }, { label: "Yesterday", threads: [t("c")] }];

  it("needs no hold when nothing would move", () => {
    const incoming = [{ label: "Today", threads: [t("a", { unread_count: 1 }), t("b")] }, { label: "Yesterday", threads: [t("c")] }];
    expect(holdIncoming(shown, incoming)).toBeNull();
  });

  it("keeps the rows where they are and holds new ones back", () => {
    const incoming = [{ label: "Today", threads: [t("n1"), t("a"), t("n2"), t("b")] }, { label: "Yesterday", threads: [t("c")] }];
    const held = holdIncoming(shown, incoming)!;
    expect(ids(held.view)).toEqual(["Today: a b", "Yesterday: c"]);
    expect([...held.waiting]).toEqual(["n1", "n2"]);
  });

  it("shows what changed in a row it keeps in place", () => {
    const incoming = [{ label: "Today", threads: [t("c", { snippet: "new reply" }), t("a"), t("b")] }];
    const held = holdIncoming(shown, incoming)!;
    expect(ids(held.view)).toEqual(["Today: a b", "Yesterday: c"]);
    expect(held.view[1].threads[0].snippet).toBe("new reply");
    expect(held.waiting.size).toBe(0);
  });

  it("leaves a row that went in place until the hold ends", () => {
    const incoming = [{ label: "Today", threads: [t("a")] }, { label: "Yesterday", threads: [t("c")] }];
    const held = holdIncoming(shown, incoming)!;
    expect(ids(held.view)).toEqual(["Today: a b", "Yesterday: c"]);
  });
});

describe("releaseHeld", () => {
  it("lets the incoming list in, with the rows held back", () => {
    const current = [{ label: "Today", threads: [t("a"), t("b")] }];
    const incoming = [{ label: "Today", threads: [t("n1"), t("a"), t("b")] }];
    expect(ids(releaseHeld(current, incoming, new Set(["n1"])))).toEqual(["Today: n1 a b"]);
  });

  it("keeps what was done to a row while it was held, and doesn't bring back one acted away", () => {
    const current = [{ label: "Today", threads: [t("a", { labels: ["INBOX", "STARRED"] })] }];
    const incoming = [{ label: "Today", threads: [t("n1"), t("a"), t("b")] }];
    const released = releaseHeld(current, incoming, new Set(["n1"]));
    expect(ids(released)).toEqual(["Today: n1 a"]);
    expect(released[0].threads[1].labels).toContain("STARRED");
  });

  it("drops a group left empty", () => {
    const current = [{ label: "Today", threads: [t("a")] }];
    const incoming = [{ label: "Today", threads: [t("a")] }, { label: "Yesterday", threads: [t("gone")] }];
    expect(ids(releaseHeld(current, incoming, new Set()))).toEqual(["Today: a"]);
  });
});

describe("createPointerHold", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("holds while the pointer rests on the card, and lets go 300ms after it leaves", () => {
    vi.useFakeTimers();
    const release = vi.fn();
    const hold = createPointerHold(release);
    hold.enter("inbox");
    expect(hold.held("inbox")).toBe(true);
    hold.leave("inbox");
    expect(hold.held("inbox")).toBe(true);
    vi.advanceTimersByTime(299);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hold.held("inbox")).toBe(false);
    expect(release).toHaveBeenCalledWith("inbox");
  });

  it("keeps holding when the pointer passes out and back in", () => {
    vi.useFakeTimers();
    const release = vi.fn();
    const hold = createPointerHold(release);
    hold.enter("inbox");
    hold.leave("inbox");
    vi.advanceTimersByTime(200);
    hold.enter("inbox");
    vi.advanceTimersByTime(400);
    expect(release).not.toHaveBeenCalled();
    expect(hold.held("inbox")).toBe(true);
  });

  it("holds while the keyboard focus is in the card and lets go as soon as it leaves", () => {
    const release = vi.fn();
    const hold = createPointerHold(release);
    hold.focus("inbox", true);
    expect(hold.held("inbox")).toBe(true);
    hold.focus("inbox", false);
    expect(hold.held("inbox")).toBe(false);
    expect(release).toHaveBeenCalledWith("inbox");
  });

  it("waits for both the pointer and the focus to go", () => {
    vi.useFakeTimers();
    const release = vi.fn();
    const hold = createPointerHold(release);
    hold.enter("inbox");
    hold.focus("inbox", true);
    hold.focus("inbox", false);
    expect(release).not.toHaveBeenCalled();
    hold.leave("inbox");
    vi.advanceTimersByTime(300);
    expect(release).toHaveBeenCalledOnce();
  });

  it("holds each card on its own", () => {
    const hold = createPointerHold(() => {});
    hold.enter("inbox");
    expect(hold.held("receipts")).toBe(false);
  });
});

describe("createNewMailHold", () => {
  function board() {
    const lists: Record<string, ThreadGroup[]> = { inbox: [{ label: "Today", threads: [t("a"), t("b")] }] };
    const released: string[] = [];
    let fetched = "q1";
    const hold = createNewMailHold({
      read: id => lists[id],
      write: (id, groups) => { lists[id] = groups; },
      fetchedFor: () => fetched,
      onRelease: (id, entering, letIn) => {
        released.push(`${id}: ${[...entering].join(" ")}`);
        letIn();
      },
    });
    return { lists, released, hold, refetch: (q: string) => { fetched = q; } };
  }
  const incoming = [{ label: "Today", threads: [t("n", { unread_count: 1 }), t("a"), t("b")] }];

  it("shows synced mail at once on a card nothing rests on", () => {
    const { lists, hold } = board();
    hold.show("inbox", incoming);
    expect(ids(lists.inbox)).toEqual(["Today: n a b"]);
    expect(hold.waiting("inbox")).toBeUndefined();
  });

  it("holds it on a card the pointer rests on, offering it for counting, and lets it in on leaving", () => {
    vi.useFakeTimers();
    const { lists, hold, released } = board();
    hold.enter("inbox");
    hold.show("inbox", incoming);
    expect(ids(lists.inbox)).toEqual(["Today: a b"]);
    expect(ids(hold.waiting("inbox")!)).toEqual(["Today: n a b"]);

    hold.leave("inbox");
    vi.advanceTimersByTime(300);
    expect(ids(lists.inbox)).toEqual(["Today: n a b"]);
    expect(released).toEqual(["inbox: n"]);
    expect(hold.waiting("inbox")).toBeUndefined();
    vi.useRealTimers();
  });

  it("drops what it held for a card whose query changed meanwhile", () => {
    const { lists, hold, refetch } = board();
    hold.focus("inbox", true);
    hold.show("inbox", incoming);
    refetch("q2");
    lists.inbox = [{ label: "Today", threads: [t("x")] }];
    hold.focus("inbox", false);
    expect(ids(lists.inbox)).toEqual(["Today: x"]);
  });

  it("forgets a card", () => {
    const { hold } = board();
    hold.focus("inbox", true);
    hold.show("inbox", incoming);
    hold.forget("inbox");
    expect(hold.waiting("inbox")).toBeUndefined();
  });
});
