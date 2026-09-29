import { describe, expect, it } from "vitest";
import { failureMessage } from "./errorText";

describe("failureMessage", () => {
  it("says what couldn't be done, keeping the backend's text apart as details", () => {
    expect(failureMessage("Couldn't star 1 thread", new Error("API error 500: backendError"))).toEqual({
      message: "Couldn't star 1 thread.",
      details: "Error: API error 500: backendError",
    });
  });

  it("says what to do when the connection is down", () => {
    expect(failureMessage("Couldn't send the reply", "error sending request for url (https://gmail.googleapis.com)").message)
      .toBe("Couldn't send the reply. Check your connection and try again.");
  });

  it("says to sign in again when the session expired", () => {
    expect(failureMessage("Couldn't archive 1 thread", 'Token refresh failed: {"error": "invalid_grant"}').message)
      .toBe("Couldn't archive 1 thread. Your session expired; sign in again.");
  });

  it("keeps a sentence that already ends in punctuation as it is", () => {
    expect(failureMessage("Couldn't send “Hello?”", "x").message).toBe("Couldn't send “Hello?”");
  });
});
