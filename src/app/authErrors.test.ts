import { describe, expect, it } from "vitest";
import { isSessionExpiredError, needsSignInAgain } from "./authErrors";

describe("isSessionExpiredError", () => {
  it("treats a revoked or expired refresh token as an expired session", () => {
    expect(isSessionExpiredError('Token refresh failed: {"error": "invalid_grant", "error_description": "Token has been expired or revoked."}')).toBe(true);
  });

  it("treats a missing stored refresh token as an expired session", () => {
    expect(isSessionExpiredError("Keyring error: No refresh token found")).toBe(true);
  });

  it("does not sign out on a transient failure while refreshing", () => {
    expect(isSessionExpiredError("Token refresh failed: 503 Service Unavailable")).toBe(false);
    expect(isSessionExpiredError("HTTP error: error sending request")).toBe(false);
  });

  it("does not sign out on a stale access token, which the backend refreshes on the next call", () => {
    expect(isSessionExpiredError('API error 401 Unauthorized: {"error": {"status": "UNAUTHENTICATED"}}')).toBe(false);
  });

  it("ignores ordinary API errors", () => {
    expect(isSessionExpiredError("API error 404 Not Found: thread")).toBe(false);
    expect(isSessionExpiredError("Calendar not found.")).toBe(false);
  });
});

describe("needsSignInAgain", () => {
  it("covers an expired session", () => {
    expect(needsSignInAgain("Keyring error: No refresh token found")).toBe(true);
  });

  it("covers calendar access that only signing in again can grant", () => {
    expect(needsSignInAgain("Calendar permission denied. Please re-login to grant calendar access.")).toBe(true);
    expect(needsSignInAgain("Calendar access expired. Please re-login to refresh permissions.")).toBe(true);
  });

  it("does not cover a locked keychain, which unlocking fixes", () => {
    const locked = "Keychain unavailable (locked or access denied). Unlock the keychain and try again. (User interaction is not allowed.)";
    expect(isSessionExpiredError(locked)).toBe(false);
    expect(needsSignInAgain(locked)).toBe(false);
  });

  it("does not cover errors that signing in again doesn't fix", () => {
    expect(needsSignInAgain("Calendar access expired. Please re-login.")).toBe(false);
    expect(needsSignInAgain("Calendar API not enabled. Please enable Google Calendar API in your Google Cloud Console and re-login.")).toBe(false);
    expect(needsSignInAgain("Too many requests. Please try again later.")).toBe(false);
  });
});
