import { isSessionExpiredError } from "./authErrors";

// Shown in the thread view when a thread's messages can't be loaded
export function threadLoadErrorMessage(error: unknown): string {
  const text = String(error);
  if (isSessionExpiredError(text)) return "Your session expired. Sign in again to load this email.";
  if (text.includes("API error 404")) return "This email no longer exists. It may have been deleted or moved.";
  if (/error sending request|timed out|network/i.test(text)) return "Couldn't reach Gmail. Check your connection and open the email again.";
  return `Couldn't load this email: ${text}`;
}
