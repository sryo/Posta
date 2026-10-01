import { describe, expect, it } from "vitest";
import { findHeader, lastMessageFromOthers, messageDate, nearestShownIndex, reactionsShownAsChips, stepShownIndex } from "./messages";

const msg = (id: string, headers: Record<string, string>) => ({
  id,
  payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
});

describe("findHeader", () => {
  it("matches header names case-insensitively", () => {
    const headers = [{ name: "Message-Id", value: "<abc@x>" }, { name: "from", value: "Ana <a@x>" }];
    expect(findHeader(headers, "Message-ID")).toBe("<abc@x>");
    expect(findHeader(headers, "From")).toBe("Ana <a@x>");
    expect(findHeader(headers, "Subject")).toBeUndefined();
    expect(findHeader(undefined, "From")).toBeUndefined();
  });
});

describe("lastMessageFromOthers", () => {
  it("skips the account's own trailing replies", () => {
    const messages = [
      msg("1", { From: "Ana <ana@x.com>" }),
      msg("2", { From: "Bo <bo@x.com>" }),
      msg("3", { From: "Me <ME@x.com>" }),
    ];
    expect(lastMessageFromOthers(messages, "me@x.com")?.id).toBe("2");
  });

  it("falls back to the last message when every message is the account's", () => {
    const messages = [msg("1", { From: "me@x.com" }), msg("2", { from: "me@x.com" })];
    expect(lastMessageFromOthers(messages, "me@x.com")?.id).toBe("2");
  });

  it("reads a lowercase From header", () => {
    const messages = [msg("1", { from: "ana@x.com" }), msg("2", { from: "me@x.com" })];
    expect(lastMessageFromOthers(messages, "me@x.com")?.id).toBe("1");
  });

  it("skips reactions from others", () => {
    const messages = [
      msg("1", { From: "Ana <ana@x.com>" }),
      { ...msg("2", { From: "Bo <bo@x.com>" }), reaction: { emoji: "👍" } },
    ];
    expect(lastMessageFromOthers(messages, "me@x.com")?.id).toBe("1");
  });

  it("returns undefined for an empty thread", () => {
    expect(lastMessageFromOthers([], "me@x.com")).toBeUndefined();
  });
});

describe("reactionsShownAsChips", () => {
  const reaction = (id: string, inReplyTo: string) => ({
    ...msg(id, { From: "Bob <bob@x>" }),
    reaction: { emoji: "👍", from_addr: "bob@x", in_reply_to: inReplyTo, message_id: id },
  });

  it("names reactions whose message is in the thread, matching Message-IDs loosely", () => {
    const messages = [msg("m0", { "Message-ID": "<Abc@x>" }), reaction("m1", "abc@X"), reaction("m2", "<elsewhere@x>")];
    expect([...reactionsShownAsChips(messages)]).toEqual(["m1"]);
  });
});

describe("shown message navigation", () => {
  const hidden = [false, true, false, true];

  it("steps over hidden messages and stops at the ends", () => {
    expect(stepShownIndex(0, 1, hidden)).toBe(2);
    expect(stepShownIndex(2, 1, hidden)).toBe(2);
    expect(stepShownIndex(2, -1, hidden)).toBe(0);
    expect(stepShownIndex(0, -1, hidden)).toBe(0);
  });

  it("moves focus off a hidden message to the closest earlier one, or a later one", () => {
    expect(nearestShownIndex(3, hidden)).toBe(2);
    expect(nearestShownIndex(1, [true, true, false])).toBe(2);
    expect(nearestShownIndex(2, hidden)).toBe(2);
  });
});

describe("messageDate", () => {
  it("dates a message by when Gmail received it", () => {
    const sent = Date.UTC(2025, 7, 21, 9, 30);
    expect(messageDate({ internalDate: String(sent), payload: { headers: [{ name: "Date", value: "Mon, 1 Jan 2024 10:00:00 +0000" }] } }))
      .toEqual(new Date(sent));
  });

  it("falls back to its Date header, and to nothing when neither reads as a date", () => {
    expect(messageDate(msg("1", { Date: "Mon, 1 Jan 2024 10:00:00 +0000" }))).toEqual(new Date(Date.UTC(2024, 0, 1, 10)));
    expect(messageDate(msg("1", { Date: "soon" }))).toBeNull();
    expect(messageDate({ internalDate: "x" })).toBeNull();
    expect(messageDate({})).toBeNull();
  });
});
