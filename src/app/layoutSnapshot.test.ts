import { beforeEach, describe, expect, it } from "vitest";
import type { Card } from "../api/tauri";
import { cardSpecs, clearLayoutSnapshot, loadLayoutSnapshot, saveLayoutSnapshot, SNAPSHOT_TTL_MS } from "./layoutSnapshot";

const card = (id: string, name: string, query: string, color: string | null = null): Card => ({
  id, account_id: "a", name, query, position: 0, collapsed: false, color, group_by: "sender",
  card_type: query.startsWith("calendar:") ? "calendar" : "email",
});

beforeEach(() => localStorage.clear());

describe("cardSpecs", () => {
  it("keeps what recreates a card and drops its identity", () => {
    expect(cardSpecs([card("c1", "Inbox", "is:inbox", "blue"), card("c2", "Today", "calendar:today")])).toEqual([
      { name: "Inbox", query: "is:inbox", color: "blue", group_by: "sender", card_type: "email" },
      { name: "Today", query: "calendar:today", color: null, group_by: "sender", card_type: "calendar" },
    ]);
  });
});

describe("layout snapshots", () => {
  const cards = cardSpecs([card("c1", "Inbox", "is:inbox", "blue")]);

  it("keeps a replaced layout per mailbox", () => {
    saveLayoutSnapshot("a@x.com", cards, 1000);
    expect(loadLayoutSnapshot("a@x.com", 2000)).toEqual({ savedAt: 1000, cards });
    expect(loadLayoutSnapshot("b@x.com", 2000)).toBeNull();
  });

  it("forgets a snapshot after 30 days", () => {
    saveLayoutSnapshot("a@x.com", cards, 0);
    expect(loadLayoutSnapshot("a@x.com", SNAPSHOT_TTL_MS)).not.toBeNull();
    expect(loadLayoutSnapshot("a@x.com", SNAPSHOT_TTL_MS + 1)).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("keeps nothing for an empty layout and can be cleared", () => {
    saveLayoutSnapshot("a@x.com", [], 0);
    expect(loadLayoutSnapshot("a@x.com", 0)).toBeNull();
    saveLayoutSnapshot("a@x.com", cards, 0);
    clearLayoutSnapshot("a@x.com");
    expect(loadLayoutSnapshot("a@x.com", 0)).toBeNull();
  });

  it("ignores a damaged entry", () => {
    localStorage.setItem("layoutSnapshot:a@x.com", "{nope");
    expect(loadLayoutSnapshot("a@x.com", 0)).toBeNull();
  });
});
