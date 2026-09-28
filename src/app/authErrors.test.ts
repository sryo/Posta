import { describe, expect, it } from "vitest";
import { isSessionExpiredError } from "./authErrors";

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
