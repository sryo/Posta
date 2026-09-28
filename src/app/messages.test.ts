import { describe, expect, it } from "vitest";
import { findHeader, lastMessageFromOthers } from "./messages";

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
