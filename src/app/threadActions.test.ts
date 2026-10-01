import { describe, expect, it } from "vitest";
import type { Thread, ThreadGroup } from "../api/tauri";
import { actionFailureMessage, actionMessage, actionRemovesFromCard, actionUndoneMessage, applyLabelChange, backInPlace, changeRemovesFromCard, undoFailureMessage, labelChangeMessage, restoreThreads, applyThreadAction, labelChangeFor, threadMayJoinCard, undoLabelChanges } from "./threadActions";

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

const mail = (subject: string, ...participants: string[]) => ({ subject, participants });

describe("actionMessage", () => {
  it("names one thread by its subject", () => {
    expect(actionMessage("archive", [mail("Venue for the offsite", "Ana <ana@x.com>")])).toBe("Archived “Venue for the offsite”");
    expect(actionMessage("trash", [mail("Venue for the offsite")])).toBe("Moved “Venue for the offsite” to Trash");
    expect(actionMessage("read", [mail("Venue for the offsite")])).toBe("Marked “Venue for the offsite” as read");
  });

  it("names the sender's message when the subject is empty", () => {
    expect(actionMessage("archive", [mail("", "Ana Pérez <ana@x.com>")])).toBe("Archived Ana Pérez's message");
    expect(actionMessage("star", [mail(" ")])).toBe("Starred a message with no subject");
  });

  it("names the sender, not the user, of a thread they replied to", () => {
    expect(actionMessage("archive", [mail("", "me@x.com", "Ben <ben@x.com>")], { ownEmails: ["me@x.com"] })).toBe("Archived Ben's message");
  });

  it("names both senders of two threads", () => {
    expect(actionMessage("archive", [mail("One", "Ana <ana@x.com>"), mail("Two", "Ben <ben@x.com>")])).toBe("Archived 2, from Ana and Ben");
    expect(actionMessage("trash", [mail("One", "Ana <ana@x.com>"), mail("Two", "Ben <ben@x.com>")])).toBe("Moved 2, from Ana and Ben, to Trash");
  });

  it("names the one sender of several threads", () => {
    const threads = Array.from({ length: 6 }, (_, i) => mail(`Issue ${i}`, "GitHub <notifications@github.com>"));
    expect(actionMessage("archive", threads)).toBe("Archived 6 from GitHub");
    expect(actionMessage("read", threads)).toBe("Marked 6 from GitHub as read");
  });

  it("says all when the action took every thread in the card", () => {
    const threads = Array.from({ length: 14 }, (_, i) => mail(`News ${i}`, `List ${i} <l${i}@x.com>`));
    expect(actionMessage("archive", threads, { card: { name: "Newsletters", total: 14 } })).toBe("Archived all 14 in Newsletters");
    expect(actionMessage("archive", threads.slice(0, 2), { card: { name: "Newsletters", total: 2 } })).toBe("Archived both in Newsletters");
  });

  it("doesn't say all when the card holds more than it has loaded", () => {
    const threads = Array.from({ length: 3 }, (_, i) => mail(`News ${i}`, `List ${i} <l${i}@x.com>`));
    expect(actionMessage("archive", threads, { card: { name: "Newsletters", total: null } })).toBe("Archived 3 threads");
  });

  it("counts several threads from several senders", () => {
    const threads = [mail("A", "Ana <a@x.com>"), mail("B", "Ben <b@x.com>"), mail("C", "Cy <c@x.com>")];
    expect(actionMessage("spam", threads)).toBe("Moved 3 threads to spam");
    expect(actionMessage("bogus", threads)).toBe("Changed 3 threads");
  });
});

describe("actionFailureMessage", () => {
  it("names the thread that couldn't be changed", () => {
    expect(actionFailureMessage("archive", [mail("Venue for the offsite")])).toBe("Couldn't archive “Venue for the offsite”");
    expect(actionFailureMessage("trash", [mail("A", "Ana <a@x.com>"), mail("B", "Ana <a@x.com>"), mail("C", "Ana <a@x.com>")])).toBe("Couldn't delete 3 from Ana");
    expect(actionFailureMessage("notImportant", [mail("Venue")])).toBe("Couldn't mark “Venue” as not important");
  });
});

describe("actionUndoneMessage", () => {
  it("says what undoing the action did", () => {
    expect(actionUndoneMessage("archive", [mail("Contract v3, two redlines")])).toBe("Unarchived “Contract v3, two redlines”");
    expect(actionUndoneMessage("trash", [mail("Venue")])).toBe("Restored “Venue” from Trash");
    expect(actionUndoneMessage("read", [mail("Venue")])).toBe("Marked “Venue” as unread");
    expect(actionUndoneMessage("spam", [mail("Venue")])).toBe("Moved “Venue” out of spam");
  });
});

describe("undoFailureMessage", () => {
  it("names what couldn't be undone, as what undoing would have done", () => {
    expect(undoFailureMessage("archive", [mail("Venue")])).toBe("Couldn't unarchive “Venue”");
    expect(undoFailureMessage("trash", [mail("Venue")])).toBe("Couldn't restore “Venue” from Trash");
    expect(undoFailureMessage("read", [mail("Venue")])).toBe("Couldn't mark “Venue” as unread");
    expect(undoFailureMessage("bogus", [mail("Venue")])).toBe("Couldn't undo changes to “Venue”");
  });
});

describe("labelChangeMessage", () => {
  it("names the label and the thread", () => {
    expect(labelChangeMessage(true, "Receipts", mail("Venue"))).toBe("Added “Receipts” to “Venue”");
    expect(labelChangeMessage(false, "Receipts", mail("", "Ana <a@x.com>"))).toBe("Removed “Receipts” from Ana's message");
  });

  it("names them when the change failed", () => {
    expect(labelChangeMessage(true, "Receipts", mail("Venue"), "failed")).toBe("Couldn't add “Receipts” to “Venue”");
    expect(labelChangeMessage(false, "Receipts", mail("Venue"), "failed")).toBe("Couldn't remove “Receipts” from “Venue”");
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
    const undo = undoLabelChanges("a", ["t1", "t2"], labelChangeFor("star"), before(thread("t1", ["STARRED"]), thread("t2", [])));
    expect(undo).toEqual([{ accountId: "a", threadIds: ["t2"], add: [], remove: ["STARRED"] }]);
  });

  it("does not move a thread into the inbox that archive never took out of it", () => {
    const undo = undoLabelChanges("a", ["t1", "t2"], labelChangeFor("archive"), before(thread("t1", ["STARRED"]), thread("t2", ["INBOX"])));
    expect(undo).toEqual([{ accountId: "a", threadIds: ["t2"], add: ["INBOX"], remove: [] }]);
  });

  it("marks unread again only the threads that were unread", () => {
    const undo = undoLabelChanges("a", ["t1", "t2"], labelChangeFor("read"), before(thread("t1", ["INBOX"], 2), thread("t2", ["INBOX"])));
    expect(undo).toEqual([{ accountId: "a", threadIds: ["t1"], add: ["UNREAD"], remove: [] }]);
  });

  it("groups threads by the change that reverses them", () => {
    const undo = undoLabelChanges("a", ["t1", "t2", "t3"], labelChangeFor("spam"), before(thread("t1", ["INBOX"]), thread("t2", []), thread("t3", ["INBOX"])));
    expect(undo).toEqual([
      { accountId: "a", threadIds: ["t1", "t3"], add: ["INBOX"], remove: ["SPAM"] },
      { accountId: "a", threadIds: ["t2"], add: [], remove: ["SPAM"] },
    ]);
  });

  it("reverses the change in the account it was made in", () => {
    expect(undoLabelChanges("b", ["t1"], labelChangeFor("trash"), before(thread("t1", ["INBOX"])))[0].accountId).toBe("b");
  });

  it("reverses the whole change for a thread whose labels were not known", () => {
    expect(undoLabelChanges("a", ["t9"], labelChangeFor("archive"), before())).toEqual([{ accountId: "a", threadIds: ["t9"], add: ["INBOX"], remove: [] }]);
  });
});

describe("threadMayJoinCard", () => {
  it("keeps spam and trash out of cards that don't search them", () => {
    expect(threadMayJoinCard(thread("t", ["SPAM", "UNREAD"]), "is:inbox")).toBe(false);
    expect(threadMayJoinCard(thread("t", ["TRASH"]), "has:attachment")).toBe(false);
  });

  it("lets spam and trash into cards that search them", () => {
    expect(threadMayJoinCard(thread("t", ["SPAM"]), "in:spam")).toBe(true);
    expect(threadMayJoinCard(thread("t", ["TRASH"]), "in:anywhere from:bo")).toBe(true);
    expect(threadMayJoinCard(thread("t", ["TRASH"]), "label:Trash")).toBe(true);
  });

  it("lets a thread that still has mail in the inbox in", () => {
    expect(threadMayJoinCard(thread("t", ["TRASH", "INBOX"]), "is:inbox")).toBe(true);
  });

  it("lets any other thread in", () => {
    expect(threadMayJoinCard(thread("t", ["SENT"]), "is:inbox")).toBe(true);
  });
});

describe("restoreThreads", () => {
  const byId = (...ids: string[]) => (t: Thread) => ids.includes(t.gmail_thread_id);

  it("puts a removed thread back in the slot it left", () => {
    const before = groups(thread("a", ["INBOX"]), thread("b", ["INBOX"]), thread("c", ["INBOX"]));
    const after = groups(thread("a", ["INBOX"]), thread("c", ["INBOX"]));
    expect(restoreThreads(after, before, byId("b"))[0].threads.map(t => t.gmail_thread_id)).toEqual(["a", "b", "c"]);
  });

  it("gives a thread still shown its labels back", () => {
    const before = groups(thread("a", ["INBOX", "UNREAD"], 1));
    const after = groups(thread("a", ["INBOX"], 0));
    expect(restoreThreads(after, before, byId("a"))[0].threads[0]).toMatchObject({ labels: ["INBOX", "UNREAD"], unread_count: 1 });
  });

  it("brings back a group that emptied, where it was", () => {
    const before: ThreadGroup[] = [
      { label: "Today", threads: [thread("a", ["INBOX"])] },
      { label: "Yesterday", threads: [thread("b", ["INBOX"])] },
      { label: "Older", threads: [thread("c", ["INBOX"])] },
    ];
    const after: ThreadGroup[] = [before[0], before[2]];
    expect(restoreThreads(after, before, byId("b")).map(g => g.label)).toEqual(["Today", "Yesterday", "Older"]);
  });

  it("leaves other threads as they are now", () => {
    const before = groups(thread("a", ["INBOX"]), thread("b", ["INBOX"]));
    const after = groups(thread("a", ["INBOX", "STARRED"]));
    const restored = restoreThreads(after, before, byId("b"))[0].threads;
    expect(restored.map(t => [t.gmail_thread_id, t.labels])).toEqual([["a", ["INBOX", "STARRED"]], ["b", ["INBOX"]]]);
  });
});

describe("backInPlace", () => {
  it("says where in the card the thread is back", () => {
    const shown = groups(thread("a", []), thread("b", []), thread("c", []));
    expect(backInPlace(shown, "a", "Inbox")).toBe(" · back 1st in Inbox");
    expect(backInPlace(shown, "b", "Inbox")).toBe(" · back 2nd in Inbox");
    expect(backInPlace(groups(...Array.from({ length: 23 }, (_, i) => thread(`t${i}`, []))), "t22", "Inbox")).toBe(" · back 23rd in Inbox");
    expect(backInPlace(groups(...Array.from({ length: 12 }, (_, i) => thread(`t${i}`, []))), "t10", "Inbox")).toBe(" · back 11th in Inbox");
  });

  it("says nothing of a thread the card doesn't show", () => {
    expect(backInPlace(groups(thread("a", [])), "z", "Inbox")).toBe("");
  });
});

describe("applyLabelChange", () => {
  const groups: ThreadGroup[] = [{ label: "Today", threads: [
    { gmail_thread_id: "a", account_id: "x", subject: "", snippet: "", last_message_date: 0, unread_count: 0, labels: ["INBOX"], participants: [], has_attachment: false, attachments: [], calendar_event: null },
    { gmail_thread_id: "b", account_id: "x", subject: "", snippet: "", last_message_date: 0, unread_count: 2, labels: ["INBOX"], participants: [], has_attachment: false, attachments: [], calendar_event: null },
  ] }];

  it("adds and removes labels on the threads it names", () => {
    const [group] = applyLabelChange(groups, ["a"], { add: ["Label_1"], remove: ["INBOX"] }, false);
    expect(group.threads[0].labels).toEqual(["Label_1"]);
    expect(group.threads[1].labels).toEqual(["INBOX"]);
  });

  it("takes them out of the card when asked", () => {
    const [group] = applyLabelChange(groups, ["a"], { add: ["Label_1"], remove: ["INBOX"] }, true);
    expect(group.threads.map(t => t.gmail_thread_id)).toEqual(["b"]);
  });

  it("reads UNREAD as the unread count", () => {
    expect(applyLabelChange(groups, ["a"], { add: ["UNREAD"], remove: [] }, false)[0].threads[0].unread_count).toBe(1);
    expect(applyLabelChange(groups, ["b"], { add: [], remove: ["UNREAD"] }, false)[0].threads[1].unread_count).toBe(0);
  });
});

describe("changeRemovesFromCard", () => {
  it("takes a thread out of an inbox card when it leaves the Inbox, as archiving does", () => {
    expect(changeRemovesFromCard({ add: ["Label_1"], remove: ["INBOX"] }, "in:inbox")).toBe(true);
    expect(changeRemovesFromCard({ add: ["Label_1"], remove: ["INBOX"] }, "is:starred")).toBe(false);
    expect(changeRemovesFromCard({ add: ["Label_1"], remove: [] }, "in:inbox")).toBe(false);
  });

  it("takes it out of every card when it goes to the trash or spam", () => {
    expect(changeRemovesFromCard({ add: ["TRASH"], remove: [] }, "is:starred")).toBe(true);
  });
});
