import { describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { createSentReplies } from "./sentReplies";

const message = (id: string, labelIds: string[] = []) => ({ id, labelIds });

describe("createSentReplies", () => {
  const setup = () => createRoot(() => createSentReplies<{ text: string }>());

  it("holds a reply as sending in its thread until it settles", () => {
    const replies = setup();
    const item = { text: "On my way" };
    const before = Date.now();
    replies.add("t1", item, ["m1"]);
    const [sending] = replies.inThread("t1");
    expect(sending).toMatchObject({ item, state: "sending" });
    expect(sending.queuedAt).toBeGreaterThanOrEqual(before);
    expect(replies.inThread("t2")).toEqual([]);
    replies.settle(item);
    const [sent] = replies.inThread("t1");
    expect(sent).toMatchObject({ item, state: "sent", queuedAt: sending.queuedAt });
    expect(sent.sentAt).toBeGreaterThanOrEqual(sending.queuedAt);
  });

  it("lets go of a reply that is put back", () => {
    const replies = setup();
    const item = { text: "On my way" };
    replies.add("t1", item, ["m1"]);
    replies.drop(item);
    expect(replies.inThread("t1")).toEqual([]);
  });

  it("lets go of a sent reply once its thread holds a new message the account sent", () => {
    const replies = setup();
    const item = { text: "On my way" };
    replies.add("t1", item, ["m1"]);
    replies.arrived("t1", [message("m1"), message("m2", ["INBOX"])]);
    replies.arrived("t1", [message("m1"), message("m3", ["SENT"])]);
    expect(replies.inThread("t1")).toHaveLength(1);
    replies.settle(item);
    replies.arrived("t2", [message("m4", ["SENT"])]);
    expect(replies.inThread("t1")).toHaveLength(1);
    replies.arrived("t1", [message("m1"), message("m3", ["SENT"])]);
    expect(replies.inThread("t1")).toEqual([]);
  });
});
