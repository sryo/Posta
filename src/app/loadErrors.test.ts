import { describe, expect, it } from "vitest";
import { threadLoadErrorMessage } from "./loadErrors";

describe("threadLoadErrorMessage", () => {
  it("says a thread that is gone was deleted", () => {
    expect(threadLoadErrorMessage('API error 404 Not Found: {"error": {"code": 404}}')).toMatch(/no longer exists/);
  });

  it("asks to sign in again for an expired session", () => {
    expect(threadLoadErrorMessage('Token refresh failed: {"error": "invalid_grant"}')).toMatch(/Sign in again/);
  });

  it("says Gmail could not be reached when offline", () => {
    expect(threadLoadErrorMessage("HTTP error: error sending request for url")).toMatch(/Couldn't reach Gmail/);
  });

  it("says Gmail could not be reached when the connection fails", () => {
    const backend = "Failed to fetch thread: Request failed: could not reach Gmail. Check your connection.";
    expect(threadLoadErrorMessage(backend)).toBe("Couldn't reach Gmail. Check your connection and open the email again.");
    expect(threadLoadErrorMessage("Failed to fetch thread: Request timed out: Gmail did not respond. Check your connection and try again."))
      .toBe("Couldn't reach Gmail. Check your connection and open the email again.");
  });

  it("keeps the reason for anything else", () => {
    expect(threadLoadErrorMessage(new Error("API error 500 Internal Server Error"))).toBe("Couldn't load this email: Error: API error 500 Internal Server Error");
  });
});
