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
