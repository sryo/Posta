import { describe, expect, it } from "vitest";
import type { Thread, ThreadGroup } from "../api/tauri";
import { actionRemovesFromCard, applyThreadAction, labelChangeFor } from "./threadActions";

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
