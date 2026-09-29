import { describe, expect, it } from "vitest";
import { cardSyncStatus, cardWaitingMessage, connectionStatus } from "./connectionStatus";

const at = (h: number, m: number) => new Date(2026, 8, 29, h, m).getTime();
const time = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

describe("connectionStatus", () => {
  it("says nothing while everything works", () => {
    expect(connectionStatus({ expiredEmail: null, offline: false, reconnecting: false, lastSyncedAt: null }, time)).toBeNull();
  });

  it("says since when the shown mail is from while offline, offering to try now", () => {
    expect(connectionStatus({ expiredEmail: null, offline: true, reconnecting: false, lastSyncedAt: at(10, 42) }, time)).toEqual({
      kind: "offline", message: "You're offline — showing mail from 10:42", action: "retry",
    });
    expect(connectionStatus({ expiredEmail: null, offline: true, reconnecting: false, lastSyncedAt: null }, time)?.message)
      .toBe("You're offline");
  });

  it("shows reconnecting while a retry runs", () => {
    expect(connectionStatus({ expiredEmail: null, offline: true, reconnecting: true, lastSyncedAt: null }, time)).toEqual({
      kind: "reconnecting", message: "Reconnecting…", action: null,
    });
  });

  it("puts a lost sign-in first, offering to sign in again", () => {
    expect(connectionStatus({ expiredEmail: "mateo@posta.test", offline: true, reconnecting: true, lastSyncedAt: null }, time)).toEqual({
      kind: "expired", message: "Posta lost access to mateo@posta.test", action: "signIn",
    });
  });
});

describe("cardWaitingMessage", () => {
  it("waits for sign-in when the session expired", () => {
    expect(cardWaitingMessage("Session expired", undefined, true)).toBe("Waiting for sign-in");
  });

  it("waits for a connection when the card couldn't reach Google", () => {
    expect(cardWaitingMessage("Couldn't reach Gmail. Check your connection and try again.", "Search failed: Request failed: could not reach Gmail.", false))
      .toBe("Waiting for connection");
  });

  it("leaves errors that belong to the card to the card", () => {
    expect(cardWaitingMessage("Couldn't load this card: Invalid query", "Search failed: Invalid query", false)).toBeNull();
    expect(cardWaitingMessage("Calendar permission denied. Please re-login to grant calendar access.", "Calendar permission denied. Please re-login to grant calendar access.", false)).toBeNull();
  });
});

describe("cardSyncStatus", () => {
  const now = at(11, 0);
  const status = (state: Partial<Parameters<typeof cardSyncStatus>[0]>) =>
    cardSyncStatus({ lastSyncedAt: at(10, 55), now, syncError: null, offline: false, expired: false, ...state });

  it("says when the card last synced, for refresh's name, and shows no problem", () => {
    expect(status({ lastSyncedAt: now - 1000 })).toEqual({ summary: "synced just now", problem: null });
    expect(status({})).toEqual({ summary: "synced 5m ago", problem: null });
  });

  it("says nothing for a card that never synced", () => {
    expect(status({ lastSyncedAt: null })).toEqual({ summary: null, problem: null });
  });

  it("names the board being offline, keeping the cached mail's age", () => {
    expect(status({ offline: true, syncError: "could not reach Gmail" })).toEqual({ summary: "offline, synced 5m ago", problem: "Offline" });
    expect(status({ offline: true, lastSyncedAt: null })).toEqual({ summary: "offline", problem: "Offline" });
  });

  it("names a lost sign-in before anything else", () => {
    expect(status({ expired: true, offline: true })).toEqual({ summary: "signed out, synced 5m ago", problem: "Signed out" });
  });

  it("names a failure only this card has, with its reason", () => {
    expect(status({ syncError: "Invalid query" })).toEqual({ summary: "sync failed: Invalid query, synced 5m ago", problem: "Sync failed" });
  });

  it("keeps raw backend text out of a failed sync's summary", () => {
    expect(status({ syncError: 'Search failed: API error 500: {"error": {"code": 500}}' }).summary).toBe("sync failed, synced 5m ago");
    expect(status({ syncError: "Search failed: API error 400: Invalid query" }).summary).toBe("sync failed: Gmail didn't understand this card's query, synced 5m ago");
  });
});
