import { isSessionExpiredError, needsSignInAgain } from "./authErrors";

export const OFFLINE = /error sending request|could not reach|couldn't reach|timed out|didn't respond|did not respond|network/i;

// Errors meaning Google couldn't be reached at all
export function isOfflineError(error: unknown): boolean {
  return OFFLINE.test(String(error));
}

// Gmail's answer to a search it can't parse
const BAD_QUERY = /API error 400\b/;
// Text from an API or HTTP library, not written for people: a status code,
// a JSON body, a transport error
const RAW = /API error \d{3}|\(\d{3}\)|request failed|HTTP error|Token refresh failed|Keyring error|Failed to |Lock error|[{}]/i;

// The backend's reason without its "Search failed: " prefixes, when it is
// one written for people
function readableReason(text: string): string | null {
  const reason = text.replace(/^(Search failed: |Request failed: )+/, "").trim();
  return reason && !RAW.test(reason) ? reason : null;
}

// Shown in the thread view when a thread's messages can't be loaded
export function threadLoadErrorMessage(error: unknown): string {
  const text = String(error);
  if (isSessionExpiredError(text)) return "Your session expired. Sign in again to load this email.";
  if (text.includes("API error 404")) return "This email no longer exists. It may have been deleted or moved.";
  if (OFFLINE.test(text)) return "Couldn't reach Gmail. Check your connection and open the email again.";
  const reason = readableReason(text);
  return reason ? `Couldn't load this email: ${reason}` : "Couldn't load this email. Try opening it again.";
}

// Shown in a card that has nothing to show. A message asking the user to
// sign in again stays word for word: the card offers Sign in again for it.
export function cardLoadErrorMessage(error: unknown, calendar: boolean): string {
  const text = String(error);
  if (needsSignInAgain(text)) return text;
  if (OFFLINE.test(text)) return `Couldn't reach ${calendar ? "Google Calendar" : "Gmail"}. Check your connection and try again.`;
  if (!calendar && BAD_QUERY.test(text)) return "Couldn't load this card: Gmail didn't understand its query.";
  const reason = readableReason(text);
  return reason ? `Couldn't load this card: ${reason}` : "Couldn't load this card.";
}

// Shown in place of a card query's preview when it can't be fetched
export function queryPreviewErrorMessage(error: unknown, calendar: boolean): string {
  const text = String(error);
  if (OFFLINE.test(text)) return `Couldn't reach ${calendar ? "Google Calendar" : "Gmail"} to preview this query.`;
  if (!calendar && BAD_QUERY.test(text)) return "Gmail didn't understand this query.";
  return readableReason(text) ?? "Couldn't preview this query.";
}

// Why a card's background sync failed, for its tooltip, when that can be said
export function syncFailureReason(error: unknown): string | null {
  const text = String(error);
  if (BAD_QUERY.test(text)) return "Gmail didn't understand this card's query";
  return readableReason(text);
}

// Shown in the Batch Reply panel when none of its threads could be loaded
export function batchReplyLoadErrorMessage(error: unknown): string {
  const text = String(error);
  if (isSessionExpiredError(text)) return "Your session expired. Sign in again to reply.";
  if (OFFLINE.test(text)) return "Couldn't reach Gmail. Check your connection and try again.";
  const reason = readableReason(text);
  return reason ? `Couldn't load the emails: ${reason}` : "Couldn't load the emails.";
}
