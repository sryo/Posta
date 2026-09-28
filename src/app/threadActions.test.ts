import { describe, expect, it } from "vitest";
import type { Thread, ThreadGroup } from "../api/tauri";
import { actionLabel, actionRemovesFromCard, applyThreadAction, labelChangeFor, undoLabelChanges } from "./threadActions";

const thread = (id: string, labels: string[], unread = 0): Thread => ({
  gmail_thread_id: id, account_id: "a", subject: id, snippet: "", last_message_date: 0,
  unread_count: unread, labels, participants: [], has_attachment: false, attachments: [], calendar_event: null,
});
const groups = (...threads: Thread[]): ThreadGroup[] => [{ label: "Today", threads }];

describe("labelChangeFor", () => {
  it("moves spam out of the inbox", () => {
    expect(labelChangeFor("spam")).toEqual({ add: ["SPAM"], remove: ["INBOX"] });
  });

  it("changes nothing for an unknown action", () => {
    expect(labelChangeFor("bogus")).toEqual({ add: [], remove: [] });
  });
});

describe("actionLabel", () => {
  it("describes one or several threads", () => {
    expect(actionLabel("archive", 1)).toBe("Archived 1 thread");
    expect(actionLabel("spam", 3)).toBe("Moved 3 threads to spam");
    expect(actionLabel("bogus", 2)).toBe("Modified 2 threads");
  });
});

describe("actionRemovesFromCard", () => {
  it("removes archived threads only from inbox-scoped cards", () => {
    expect(actionRemovesFromCard("archive", "is:inbox is:unread")).toBe(true);
    expect(actionRemovesFromCard("archive", "Category:promotions")).toBe(true);
    expect(actionRemovesFromCard("archive", "has:attachment")).toBe(false);
  });

  it("removes trashed and spammed threads from every card", () => {
    expect(actionRemovesFromCard("trash", "is:starred")).toBe(true);
    expect(actionRemovesFromCard("spam", "has:attachment")).toBe(true);
    expect(actionRemovesFromCard("star", "is:inbox")).toBe(false);
  });
});

describe("applyThreadAction", () => {
  it("clears the unread count and label of only the targeted threads", () => {
    const result = applyThreadAction(groups(thread("a", ["INBOX", "UNREAD"], 3), thread("b", ["UNREAD"], 1)), ["a"], "read", false);
    expect(result[0].threads.map(t => [t.gmail_thread_id, t.labels, t.unread_count])).toEqual([
      ["a", ["INBOX"], 0],
      ["b", ["UNREAD"], 1],
    ]);
  });

  it("marks a read thread unread with a count of one", () => {
    const [t] = applyThreadAction(groups(thread("a", ["INBOX"])), ["a"], "unread", false)[0].threads;
    expect(t.labels).toEqual(["INBOX", "UNREAD"]);
    expect(t.unread_count).toBe(1);
  });

  it("does not duplicate a label the thread already has", () => {
    const [t] = applyThreadAction(groups(thread("a", ["STARRED"])), ["a"], "star", false)[0].threads;
    expect(t.labels).toEqual(["STARRED"]);
  });

  it("drops the targeted threads when the card no longer matches them", () => {
    const result = applyThreadAction(groups(thread("a", ["INBOX"]), thread("b", ["INBOX"])), ["a"], "archive", true);
    expect(result[0].threads.map(t => t.gmail_thread_id)).toEqual(["b"]);
  });

  it("does not mutate its input", () => {
    const input = groups(thread("a", ["INBOX"]));
    applyThreadAction(input, ["a"], "archive", false);
    expect(input[0].threads[0].labels).toEqual(["INBOX"]);
  });
});

describe("undoLabelChanges", () => {
  const before = (...threads: Thread[]) => new Map(threads.map(t => [t.gmail_thread_id, t]));

  it("only unstars the threads the star action starred", () => {
    const undo = undoLabelChanges(["t1", "t2"], labelChangeFor("star"), before(thread("t1", ["STARRED"]), thread("t2", [])));
    expect(undo).toEqual([{ threadIds: ["t2"], add: [], remove: ["STARRED"] }]);
  });

  it("does not move a thread into the inbox that archive never took out of it", () => {
    const undo = undoLabelChanges(["t1", "t2"], labelChangeFor("archive"), before(thread("t1", ["STARRED"]), thread("t2", ["INBOX"])));
    expect(undo).toEqual([{ threadIds: ["t2"], add: ["INBOX"], remove: [] }]);
  });

  it("marks unread again only the threads that were unread", () => {
    const undo = undoLabelChanges(["t1", "t2"], labelChangeFor("read"), before(thread("t1", ["INBOX"], 2), thread("t2", ["INBOX"])));
    expect(undo).toEqual([{ threadIds: ["t1"], add: ["UNREAD"], remove: [] }]);
  });

  it("groups threads by the change that reverses them", () => {
    const undo = undoLabelChanges(["t1", "t2", "t3"], labelChangeFor("spam"), before(thread("t1", ["INBOX"]), thread("t2", []), thread("t3", ["INBOX"])));
    expect(undo).toEqual([
      { threadIds: ["t1", "t3"], add: ["INBOX"], remove: ["SPAM"] },
      { threadIds: ["t2"], add: [], remove: ["SPAM"] },
    ]);
  });

  it("reverses the whole change for a thread whose labels were not known", () => {
    expect(undoLabelChanges(["t9"], labelChangeFor("archive"), before())).toEqual([{ threadIds: ["t9"], add: ["INBOX"], remove: [] }]);
  });
});
