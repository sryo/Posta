import { isSessionExpiredError, needsSignInAgain } from "./authErrors";

export const OFFLINE = /error sending request|could not reach|couldn't reach|timed out|didn't respond|did not respond|network/i;

// Shown in the thread view when a thread's messages can't be loaded
export function threadLoadErrorMessage(error: unknown): string {
  const text = String(error);
  if (isSessionExpiredError(text)) return "Your session expired. Sign in again to load this email.";
  if (text.includes("API error 404")) return "This email no longer exists. It may have been deleted or moved.";
  if (OFFLINE.test(text)) return "Couldn't reach Gmail. Check your connection and open the email again.";
  return `Couldn't load this email: ${text}`;
}

// Shown in a card that has nothing to show. A message asking the user to
// sign in again stays word for word: the card offers Sign in again for it.
export function cardLoadErrorMessage(error: unknown, calendar: boolean): string {
  const text = String(error);
  if (needsSignInAgain(text)) return text;
  if (OFFLINE.test(text)) return `Couldn't reach ${calendar ? "Google Calendar" : "Gmail"}. Check your connection and try again.`;
  return `Couldn't load this card: ${text.replace(/^(Search failed: |Request failed: )+/, "")}`;
}

// Shown in the Batch Reply panel when none of its threads could be loaded
export function batchReplyLoadErrorMessage(error: unknown): string {
  const text = String(error);
  if (isSessionExpiredError(text)) return "Your session expired. Sign in again to reply.";
  if (OFFLINE.test(text)) return "Couldn't reach Gmail. Check your connection and try again.";
  return `Couldn't load the emails: ${text}`;
}
