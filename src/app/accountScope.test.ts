import { describe, expect, it } from "vitest";
import type { Account, Card, GoogleCalendarEvent, Thread } from "../api/tauri";
import {
  ALL_ACCOUNTS,
  accountFromError,
  accountsToPoll,
  boardMixesScopes,
  cardAccountIds,
  cardCoversAccount,
  eventAccountId,
  inAccount,
  scopeLabel,
  shortAccountLabel,
  threadAccountId,
  threadIdsByAccount,
  threadKey,
} from "./accountScope";

const account = (id: string, email: string): Account => ({ id, email, picture: null, signature: null });
const a = account("a", "a@x.com");
const b = account("b", "b@x.com");
const card = (id: string, accountId: string): Card => ({
  id, account_id: accountId, name: id, query: "in:inbox", position: 0, collapsed: false,
  color: null, group_by: "date", card_type: "email",
});
const thread = (id: string, accountId: string): Thread => ({
  gmail_thread_id: id, account_id: accountId, subject: id, snippet: "", last_message_date: 0,
  unread_count: 0, labels: [], participants: [], has_attachment: false, attachments: [], calendar_event: null,
});
const event = (id: string, accountId?: string): GoogleCalendarEvent => ({
  id, calendar_id: "primary", calendar_name: "", title: id, description: null, location: null,
  start_time: 0, end_time: null, all_day: false, status: "confirmed", organizer: null, attendees: [],
  html_link: null, hangout_link: null, response_status: null, can_edit: true, account_id: accountId,
});

describe("card scope", () => {
  it("covers its own account, or every account for all inboxes", () => {
    expect(cardCoversAccount(card("c", "a"), "a")).toBe(true);
    expect(cardCoversAccount(card("c", "a"), "b")).toBe(false);
    expect(cardCoversAccount(card("c", ALL_ACCOUNTS), "b")).toBe(true);
    expect(cardAccountIds(card("c", "b"), [a, b])).toEqual(["b"]);
    expect(cardAccountIds(card("c", ALL_ACCOUNTS), [a, b])).toEqual(["a", "b"]);
  });

  it("is named by its account's email, or All inboxes", () => {
    expect(scopeLabel(card("c", "b"), [a, b])).toBe("b@x.com");
    expect(scopeLabel(card("c", ALL_ACCOUNTS), [a, b])).toBe("All inboxes");
    expect(scopeLabel(card("c", "gone"), [a, b])).toBe("");
  });
});

describe("the account behind a thread or event", () => {
  it("is the one it was fetched from, or its card's for a cache that doesn't say", () => {
    expect(threadAccountId(thread("t", "b"), card("c", ALL_ACCOUNTS))).toBe("b");
    expect(threadAccountId(thread("t", ""), card("c", "a"))).toBe("a");
    expect(threadAccountId(thread("t", ""), card("c", ALL_ACCOUNTS))).toBe("");
    expect(eventAccountId(event("e", "b"), card("c", ALL_ACCOUNTS))).toBe("b");
    expect(eventAccountId(event("e"), card("c", "a"))).toBe("a");
    expect(eventAccountId(event("e", ""), undefined)).toBe("");
  });

  it("keys a thread by its account, as ids are only unique within one mailbox", () => {
    expect(threadKey(thread("t", "a"), card("c", "a"))).toBe("a:t");
    expect(threadKey(thread("t", ""), card("c", "b"))).not.toBe(threadKey(thread("t", "a"), card("c", "a")));
  });

  it("splits a selection by account, in the order selected", () => {
    const groups = [{ label: "Today", threads: [thread("t1", "a"), thread("t2", "b"), thread("t3", "a"), thread("t4", "b")] }];
    const split = threadIdsByAccount(groups, ["t3", "t2", "t1"], card("c", ALL_ACCOUNTS));
    expect([...split.entries()]).toEqual([["a", ["t3", "t1"]], ["b", ["t2"]]]);
  });

  it("finds whose fetch failed from the email an all-inboxes error starts with", () => {
    expect(accountFromError("b@x.com: Token refresh failed: invalid_grant", [a, b])).toBe(b);
    expect(accountFromError(new Error("b@x.com: nope"), [a, b])).toBe(b);
    expect(accountFromError("Search failed: 401", [a, b])).toBeNull();
  });
});

describe("accounts to poll", () => {
  it("are those a card shows, in the accounts' order", () => {
    expect(accountsToPoll([card("c", "b")], [a, b])).toEqual([b]);
    expect(accountsToPoll([card("c", "b"), card("d", ALL_ACCOUNTS)], [a, b])).toEqual([a, b]);
    expect(accountsToPoll([], [a, b])).toEqual([]);
  });
});

describe("naming the account in a message", () => {
  it("says which account, or how many, only once there is more than one", () => {
    expect(inAccount("Archived 1 thread", ["a@x.com"], 1)).toBe("Archived 1 thread");
    expect(inAccount("Archived 1 thread", ["b@x.com"], 2)).toBe("Archived 1 thread in b@x.com");
    expect(inAccount("Archived 3 threads", ["a@x.com", "b@x.com"], 2)).toBe("Archived 3 threads in 2 accounts");
    expect(inAccount("Sending message", ["b@x.com"], 2, "from")).toBe("Sending message from b@x.com");
  });
});

describe("short account labels", () => {
  it("are the local part of each address when those differ", () => {
    const labels = shortAccountLabel([account("a", "ana@x.com"), account("b", "bo@work.com")]);
    expect(labels.get("a")).toBe("ana");
    expect(labels.get("b")).toBe("bo");
  });

  it("are the domain when two addresses share a local part", () => {
    const labels = shortAccountLabel([account("m", "mateo@posta.test"), account("w", "mateo@acme.co")]);
    expect(labels.get("m")).toBe("posta.test");
    expect(labels.get("w")).toBe("acme.co");
  });

  it("only fall back to the domain for the accounts whose local part clashes, ignoring case", () => {
    const labels = shortAccountLabel([account("m", "Mateo@posta.test"), account("w", "mateo@acme.co"), account("a", "ana@acme.co")]);
    expect([...labels.entries()]).toEqual([["m", "posta.test"], ["w", "acme.co"], ["a", "ana"]]);
  });

  it("are the whole address when neither part tells two accounts apart", () => {
    const labels = shortAccountLabel([account("a", "ana@x.com"), account("b", "ana@X.com")]);
    expect(labels.get("a")).toBe("ana@x.com");
    expect(labels.get("b")).toBe("ana@X.com");
  });
});

describe("a board that mixes scopes", () => {
  it("has cards for different accounts", () => {
    expect(boardMixesScopes([card("c", "a"), card("d", "b")], [a, b])).toBe(true);
  });

  it("has an all-inboxes card while more than one account is signed in", () => {
    expect(boardMixesScopes([card("c", ALL_ACCOUNTS)], [a, b])).toBe(true);
    expect(boardMixesScopes([card("c", ALL_ACCOUNTS), card("d", ALL_ACCOUNTS)], [a, b])).toBe(true);
  });

  it("is not one whose every card shows the same account, however many are signed in", () => {
    expect(boardMixesScopes([card("c", "a"), card("d", "a")], [a, b])).toBe(false);
    expect(boardMixesScopes([], [a, b])).toBe(false);
  });

  it("is not one with a single account signed in, where all inboxes is that account", () => {
    expect(boardMixesScopes([card("c", "a"), card("d", ALL_ACCOUNTS)], [a])).toBe(false);
  });
});
