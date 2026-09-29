import { formatSyncTime, getSyncState } from "../utils";
import { isOfflineError, syncFailureReason } from "./loadErrors";

export interface ConnectionStatus {
  kind: "offline" | "expired" | "reconnecting";
  message: string;
  action: "retry" | "signIn" | null;
}

// What the board-wide status strip says, if anything. A lost sign-in comes
// first: reconnecting can't fix it.
export function connectionStatus(
  state: { expiredEmail: string | null; offline: boolean; reconnecting: boolean; lastSyncedAt: number | null },
  formatTime: (timestamp: number) => string,
): ConnectionStatus | null {
  if (state.expiredEmail) {
    return { kind: "expired", message: `Posta lost access to ${state.expiredEmail}`, action: "signIn" };
  }
  if (state.reconnecting) return { kind: "reconnecting", message: "Reconnecting…", action: null };
  if (state.offline) {
    const since = state.lastSyncedAt ? ` — showing mail from ${formatTime(state.lastSyncedAt)}` : "";
    return { kind: "offline", message: `You're offline${since}`, action: "retry" };
  }
  return null;
}

// The quiet line a card with nothing to show gives when the status strip
// already explains why; null for an error only this card has
export function cardWaitingMessage(cardError: string, rawError: string | null | undefined, sessionExpired: boolean): string | null {
  if (sessionExpired && cardError === "Session expired") return "Waiting for sign-in";
  if (isOfflineError(rawError ?? cardError)) return "Waiting for connection";
  return null;
}

export interface CardSyncLabel {
  text: string;
  tone: "fresh" | "normal" | "stale" | "error" | "waiting";
  title: string;
}

// The age a card's header shows. While the board can't reach Google
// (`boardDown`), a card showing cached mail always shows its age, and its
// failed refreshes stay unsaid: the status strip explains them.
export function cardSyncLabel(state: { lastSyncedAt: number | null | undefined; now: number; syncError: string | null | undefined; boardDown: boolean }): CardSyncLabel | null {
  if (!state.lastSyncedAt) return null;
  const age = formatSyncTime(state.lastSyncedAt, state.now);
  const title = `Last synced: ${age}`;
  if (state.boardDown) return { text: age, tone: "waiting", title };
  if (state.syncError) {
    const reason = syncFailureReason(state.syncError);
    return { text: "sync failed", tone: "error", title: reason ? `Sync failed: ${reason}` : "Sync failed" };
  }
  return { text: age, tone: getSyncState(state.lastSyncedAt, state.now), title };
}
