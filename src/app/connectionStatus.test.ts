import { describe, expect, it } from "vitest";
import { cardSyncLabel, cardWaitingMessage, connectionStatus } from "./connectionStatus";

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

describe("cardSyncLabel", () => {
  const now = at(11, 0);

  it("says nothing for a card that never synced", () => {
    expect(cardSyncLabel({ lastSyncedAt: null, now, syncError: null, boardDown: true })).toBeNull();
  });

  it("shows a cached card's age, never a failure, while the board can't reach Google", () => {
    expect(cardSyncLabel({ lastSyncedAt: at(10, 55), now, syncError: "could not reach Gmail", boardDown: true })).toEqual({
      text: "5m ago", tone: "waiting", title: "Last synced: 5m ago",
    });
  });

  it("names a failure only this card has", () => {
    expect(cardSyncLabel({ lastSyncedAt: at(10, 55), now, syncError: "Invalid query", boardDown: false })).toEqual({
      text: "sync failed", tone: "error", title: "Sync failed: Invalid query",
    });
  });

  it("keeps raw backend text out of a failed sync's tooltip", () => {
    const title = (syncError: string) => cardSyncLabel({ lastSyncedAt: at(10, 55), now, syncError, boardDown: false })?.title;
    expect(title('Search failed: API error 500: {"error": {"code": 500}}')).toBe("Sync failed");
    expect(title("Search failed: API error 400: Invalid query")).toBe("Sync failed: Gmail didn't understand this card's query");
  });

  it("marks a fresh or old sync while everything works", () => {
    expect(cardSyncLabel({ lastSyncedAt: now - 1000, now, syncError: null, boardDown: false })?.tone).toBe("fresh");
    expect(cardSyncLabel({ lastSyncedAt: at(10, 55), now, syncError: null, boardDown: false })?.tone).toBe("normal");
    expect(cardSyncLabel({ lastSyncedAt: at(10, 0), now, syncError: null, boardDown: false })).toEqual({
      text: "1h ago", tone: "stale", title: "Last synced: 1h ago",
    });
  });
});
