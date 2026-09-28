// Errors meaning the stored sign-in can no longer work: Google rejected the
// refresh token (invalid_grant), or none could be read from the keychain.
// Transient refresh failures and plain 401s (the backend drops the cached
// access token and refreshes on the next call) are not.
export function isSessionExpiredError(message: string): boolean {
  return message.includes("invalid_grant") || message.includes("Keyring error");
}

// Errors that signing in again fixes: an expired session, or calendar access
// the backend says only a fresh sign-in can grant ("Please re-login to ...").
// A plain "Please re-login." follows a 401 the backend recovers from itself.
export function needsSignInAgain(message: string): boolean {
  return isSessionExpiredError(message) || message.includes("Please re-login to ");
}
