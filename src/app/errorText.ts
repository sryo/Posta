import { isSessionExpiredError } from "./authErrors";
import { OFFLINE } from "./loadErrors";

export interface DescribedFailure {
  // Shown: what couldn't be done, and what to do about a cause the user can fix
  message: string;
  // The backend's own text, for a Details disclosure or the console
  details: string;
}

// `failure` names what went wrong in the app's words ("Couldn't star 1
// thread"); the error only picks the advice after it
export function failureMessage(failure: string, error: unknown): DescribedFailure {
  const details = String(error);
  const sentence = /[.!?][”"]?$/.test(failure) ? failure : `${failure}.`;
  let advice = "";
  if (isSessionExpiredError(details)) advice = " Your session expired; sign in again.";
  else if (OFFLINE.test(details)) advice = " Check your connection and try again.";
  return { message: sentence + advice, details };
}

// The saved OAuth client couldn't be read; a locked keychain is the usual
// cause, and Posta reads it again when its window is next focused
export function storedCredentialsFailure(error: unknown): DescribedFailure {
  const details = String(error);
  if (details.includes("Keychain unavailable")) {
    return {
      message: "Couldn't read the saved Google credentials: the keychain is locked or Posta was denied access. Unlock it, or choose Always Allow when macOS asks, then try again.",
      details,
    };
  }
  return failureMessage("Couldn't read the saved Google credentials", error);
}
