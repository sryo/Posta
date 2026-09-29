import { describe, expect, it } from "vitest";
import { cardWaitingMessage, connectionStatus } from "./connectionStatus";

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
