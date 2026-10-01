import { describe, expect, it } from "vitest";
import type { Thread } from "../api/tauri";
import { dropIntent, timeInSubject, type DropContext } from "./dropIntent";

// Thursday 1 October 2026, 10:00
const now = new Date(2026, 9, 1, 10, 0);
const thread = (extra: Partial<Thread> = {}): Thread => ({
  gmail_thread_id: "t", account_id: "a", subject: "Your receipt", snippet: "", last_message_date: 0,
  unread_count: 0, labels: ["INBOX"], participants: ["Tomás Ruiz <tomas@x.com>", "Me <me@x.com>"], has_attachment: false, attachments: [], calendar_event: null,
  ...extra,
});
const inbox = { id: "inbox", name: "Inbox", query: "in:inbox", card_type: "email" as const };
const ctx: DropContext = {
  labelId: (name) => ({ receipts: "Label_1", "clients-acme": "Label_2" } as Record<string, string>)[name],
  labelName: (id) => ({ Label_1: "Receipts", Label_2: "Clients/Acme" } as Record<string, string>)[id] ?? id,
  accountEmail: "me@x.com",
  now,
  locale: "en-GB",
};
const card = (name: string, query: string, card_type: "email" | "calendar" = "email") => ({ id: name.toLowerCase(), name, query, card_type });

describe("dropIntent", () => {
  it("labels the thread and takes it out of the Inbox it came from, which ⌥ keeps it in", () => {
    const intent = dropIntent(thread(), inbox, card("Receipts", "label:receipts"), false, ctx);
    expect(intent).toMatchObject({ kind: "labels", text: "Label Receipts · leaves Inbox", alt: "⌥ keeps it", done: "Labelled Receipts, out of Inbox" });
    expect(intent && intent.kind === "labels" && intent.change).toEqual({ add: ["Label_1"], remove: ["INBOX"] });

    const kept = dropIntent(thread(), inbox, card("Receipts", "label:receipts"), true, ctx);
    expect(kept).toMatchObject({ kind: "labels", text: "Label Receipts · stays in Inbox", done: "Labelled Receipts, kept in Inbox" });
    expect(kept && kept.kind === "labels" && kept.change).toEqual({ add: ["Label_1"], remove: [] });
    expect(kept && kept.kind === "labels" && kept.alt).toBeUndefined();
  });

  it("only labels a thread dropped from a card that isn't its Inbox", () => {
    const intent = dropIntent(thread(), card("Starred", "is:starred"), card("Receipts", "label:receipts"), false, ctx);
    expect(intent).toMatchObject({ kind: "labels", text: "Label Receipts", done: "Labelled Receipts" });
    expect(intent && intent.kind === "labels" && intent.change).toEqual({ add: ["Label_1"], remove: [] });
  });

  it("names a nested label as Gmail does", () => {
    expect(dropIntent(thread(), card("Starred", "is:starred"), card("Acme", "label:clients-acme"), false, ctx)).toMatchObject({ text: "Label Clients/Acme" });
  });

  it("stars, marks important or unread, and keeps the thread where it was", () => {
    expect(dropIntent(thread(), inbox, card("Starred", "is:starred"), false, ctx)).toMatchObject({
      kind: "labels", text: "Star · stays in Inbox", done: "Starred", change: { add: ["STARRED"], remove: [] },
    });
    expect(dropIntent(thread(), inbox, card("Important", "is:important"), false, ctx)).toMatchObject({
      text: "Mark important · stays in Inbox", change: { add: ["IMPORTANT"], remove: [] },
    });
    expect(dropIntent(thread(), inbox, card("To do", "is:unread"), false, ctx)).toMatchObject({
      text: "Mark unread · stays in Inbox", change: { add: ["UNREAD"], remove: [] },
    });
  });

  it("puts an archived thread back in the Inbox", () => {
    expect(dropIntent(thread({ labels: ["Label_1"] }), card("Receipts", "label:receipts"), inbox, false, ctx)).toMatchObject({
      kind: "labels", text: "Move to Inbox", done: "Moved to Inbox", change: { add: ["INBOX"], remove: [] },
    });
  });

  it("does both for a card that asks for both", () => {
    expect(dropIntent(thread(), inbox, card("Paid", "label:receipts is:starred"), false, ctx)).toMatchObject({
      text: "Label Receipts and star · leaves Inbox", change: { add: ["Label_1", "STARRED"], remove: ["INBOX"] },
    });
  });

  it("says so when the thread is already there", () => {
    expect(dropIntent(thread({ labels: ["INBOX", "STARRED"] }), inbox, card("Starred", "is:starred"), false, ctx)).toEqual({ kind: "none", text: "Already in Starred" });
  });

  it("says plainly that a card it can't file into takes nothing", () => {
    for (const query of ["from:ana@x.com", "has:attachment", "invoice", "-in:inbox", "label:unknown", "older_than:7d"]) {
      expect(dropIntent(thread(), inbox, card("Other", query), false, ctx), query).toEqual({ kind: "none", text: "Can't add mail to Other" });
    }
  });

  it("offers nothing on the card it came from", () => {
    expect(dropIntent(thread(), inbox, inbox, false, ctx)).toBeNull();
  });

  it("can't move mail to a card of another account", () => {
    expect(dropIntent(thread(), inbox, card("Receipts", "label:receipts"), false, { ...ctx, otherAccount: true })).toEqual({
      kind: "none", text: "Can't move mail to another account",
    });
  });

  it("makes an event from a calendar card at the time the subject names, with the sender", () => {
    const intent = dropIntent(thread({ subject: "Call on Friday at 3pm?" }), inbox, card("This week", "calendar:week", "calendar"), false, ctx);
    expect(intent).toMatchObject({ kind: "event", text: "New event · Tomorrow, 15:00 with Tomás" });
    expect(intent && intent.kind === "event" && intent.event).toEqual({
      summary: "Call on Friday at 3pm?", attendees: "Tomás Ruiz <tomas@x.com>",
      startDate: "2026-10-02", startTime: "15:00", endDate: "2026-10-02", endTime: "15:30",
    });
  });

  it("makes an event to pick a time for when the subject names none", () => {
    const intent = dropIntent(thread({ subject: "Lunch soon" }), inbox, card("This week", "calendar:week", "calendar"), false, ctx);
    expect(intent).toMatchObject({ kind: "event", text: "New event with Tomás · pick a time" });
    expect(intent && intent.kind === "event" && intent.event).toEqual({ summary: "Lunch soon", attendees: "Tomás Ruiz <tomas@x.com>" });
  });
});

describe("timeInSubject", () => {
  it("reads a day and a time", () => {
    expect(timeInSubject("Call on Friday at 3pm", now)).toEqual(new Date(2026, 9, 2, 15, 0));
    expect(timeInSubject("Standup Mon 09:30", now)).toEqual(new Date(2026, 9, 5, 9, 30));
    expect(timeInSubject("Dinner tomorrow 8:30 pm", now)).toEqual(new Date(2026, 9, 2, 20, 30));
    expect(timeInSubject("Today at 16h", now)).toEqual(new Date(2026, 9, 1, 16, 0));
  });

  it("takes a time with no day as its next coming", () => {
    expect(timeInSubject("Sync at 11:00", now)).toEqual(new Date(2026, 9, 1, 11, 0));
    expect(timeInSubject("Sync at 9am", now)).toEqual(new Date(2026, 9, 2, 9, 0));
  });

  it("takes this day of the week as next week's once it has passed", () => {
    expect(timeInSubject("Thursday 9am", now)).toEqual(new Date(2026, 9, 8, 9, 0));
    expect(timeInSubject("Thursday 11am", now)).toEqual(new Date(2026, 9, 1, 11, 0));
  });

  it("finds nothing in a subject without a time", () => {
    expect(timeInSubject("Invoice #2291 for 3 seats", now)).toBeNull();
    expect(timeInSubject("Friday plans", now)).toBeNull();
  });
});
