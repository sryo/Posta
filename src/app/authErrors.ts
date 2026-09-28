// Errors meaning the stored sign-in can no longer work: Google rejected the
// refresh token (invalid_grant), or none could be read from the keychain.
// Transient refresh failures and plain 401s (the backend drops the cached
// access token and refreshes on the next call) are not.
export function isSessionExpiredError(message: string): boolean {
  return message.includes("invalid_grant") || message.includes("Keyring error");
}
