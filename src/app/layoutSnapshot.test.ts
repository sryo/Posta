import { beforeEach, describe, expect, it } from "vitest";
import type { Card } from "../api/tauri";
import { cardSpecs, clearLayoutSnapshot, loadLayoutSnapshot, saveLayoutSnapshot, SNAPSHOT_TTL_MS, specAccountId } from "./layoutSnapshot";

const card = (id: string, name: string, query: string, color: string | null = null): Card => ({
  id, account_id: "a", name, query, position: 0, collapsed: false, color, group_by: "sender",
  card_type: query.startsWith("calendar:") ? "calendar" : "email",
});

beforeEach(() => localStorage.clear());

describe("cardSpecs", () => {
  it("keeps what recreates a card, its account included, and drops its identity", () => {
    expect(cardSpecs([card("c1", "Inbox", "is:inbox", "blue"), { ...card("c2", "Today", "calendar:today"), account_id: "all" }])).toEqual([
      { account_id: "a", name: "Inbox", query: "is:inbox", color: "blue", group_by: "sender", card_type: "email" },
      { account_id: "all", name: "Today", query: "calendar:today", color: null, group_by: "sender", card_type: "calendar" },
    ]);
  });

  it("puts a card back in its account, or the default one when that account is gone", () => {
    const signedIn = ["a", "b"];
    expect(specAccountId({ account_id: "b" }, signedIn, "a")).toBe("b");
    expect(specAccountId({ account_id: "all" }, signedIn, "a")).toBe("all");
    expect(specAccountId({ account_id: "gone" }, signedIn, "a")).toBe("a");
    expect(specAccountId({}, signedIn, "a"), "a snapshot kept before cards named their account").toBe("a");
  });
});

describe("layout snapshots", () => {
  const cards = cardSpecs([card("c1", "Inbox", "is:inbox", "blue")]);

  it("keeps a replaced layout per mailbox", () => {
    saveLayoutSnapshot("a@x.com", cards, 1000);
    expect(loadLayoutSnapshot("a@x.com", 2000)).toEqual({ savedAt: 1000, cards });
    expect(loadLayoutSnapshot("a@x.com", 2000)?.cards[0].account_id).toBe("a");
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
