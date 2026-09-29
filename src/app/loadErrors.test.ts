import { describe, expect, it } from "vitest";
import { batchReplyLoadErrorMessage, cardLoadErrorMessage, queryPreviewErrorMessage, threadLoadErrorMessage } from "./loadErrors";

describe("queryPreviewErrorMessage", () => {
  it("keeps the reason without the backend's prefixes", () => {
    expect(queryPreviewErrorMessage("Search failed: Invalid query", false)).toBe("Invalid query");
    expect(queryPreviewErrorMessage('Unknown range "x". Try today, tomorrow, week, month, 7d, 2w', true))
      .toBe('Unknown range "x". Try today, tomorrow, week, month, 7d, 2w');
  });

  it("says the service could not be reached when offline", () => {
    expect(queryPreviewErrorMessage("Search failed: Request failed: could not reach Gmail.", false))
      .toBe("Couldn't reach Gmail to preview this query.");
    expect(queryPreviewErrorMessage("Google Calendar didn't respond.", true))
      .toBe("Couldn't reach Google Calendar to preview this query.");
  });
});

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

describe("cardLoadErrorMessage", () => {
  it("says Gmail or the calendar could not be reached when offline", () => {
    expect(cardLoadErrorMessage("Search failed: Request failed: could not reach Gmail. Check your connection.", false))
      .toBe("Couldn't reach Gmail. Check your connection and try again.");
    expect(cardLoadErrorMessage("Search failed: Request timed out: Gmail did not respond. Check your connection and try again.", false))
      .toBe("Couldn't reach Gmail. Check your connection and try again.");
    expect(cardLoadErrorMessage("Couldn't reach Google Calendar. Check your connection and try again.", true))
      .toBe("Couldn't reach Google Calendar. Check your connection and try again.");
    expect(cardLoadErrorMessage("Google Calendar didn't respond. Check your connection and try again.", true))
      .toBe("Couldn't reach Google Calendar. Check your connection and try again.");
  });

  it("keeps a message that tells the user to sign in again word for word", () => {
    const message = "Calendar permission denied. Please re-login to grant calendar access.";
    expect(cardLoadErrorMessage(message, true)).toBe(message);
  });

  it("keeps the reason for anything else, without the backend's prefixes", () => {
    expect(cardLoadErrorMessage("Search failed: API error 400 Bad Request: Invalid query", false))
      .toBe("Couldn't load this card: API error 400 Bad Request: Invalid query");
    expect(cardLoadErrorMessage("Calendar error (500)", true)).toBe("Couldn't load this card: Calendar error (500)");
  });
});

describe("batchReplyLoadErrorMessage", () => {
  it("says what went wrong in words for the batch reply panel", () => {
    expect(batchReplyLoadErrorMessage("Failed to fetch thread: Request failed: could not reach Gmail. Check your connection."))
      .toBe("Couldn't reach Gmail. Check your connection and try again.");
    expect(batchReplyLoadErrorMessage('Token refresh failed: {"error": "invalid_grant"}')).toMatch(/Sign in again/);
    expect(batchReplyLoadErrorMessage("API error 500")).toBe("Couldn't load the emails: API error 500");
  });
});
