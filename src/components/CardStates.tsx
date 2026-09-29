import { For, Show } from "solid-js";
import type { ConnectionStatus } from "../app/connectionStatus";
import { InboxIcon } from "./Icons";

// Placeholder rows shaped like the card's thread rows while it first loads
export const CardSkeleton = () => (
  <div aria-busy="true" aria-label="Loading">
    <For each={[0, 1, 2]}>
      {() => (
        <div class="card-skeleton-row">
          <div class="skeleton-line skeleton-subject"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line skeleton-short"></div>
        </div>
      )}
    </For>
  </div>
);

export const CardEmpty = (props: { query: string }) => (
  <div class="empty">
    <InboxIcon />
    <span>Nothing matches <code class="empty-query">{props.query}</code></span>
  </div>
);

// The board-wide strip saying why cards can't update, docked above the deck
export const ConnectionStatusBar = (props: { status: ConnectionStatus; onRetry: () => void; onSignIn: () => void }) => (
  <div class={`connection-status ${props.status.kind}`} aria-live="polite">
    <Show when={props.status.kind === "reconnecting"}>
      <span class="spinner-sm"></span>
    </Show>
    <span class="connection-status-message">{props.status.message}</span>
    <Show when={props.status.action === "retry"}>
      <button type="button" class="connection-status-action" onClick={() => props.onRetry()}>Try now</button>
    </Show>
    <Show when={props.status.action === "signIn"}>
      <button type="button" class="connection-status-action" onClick={() => props.onSignIn()}>Sign in again</button>
    </Show>
  </div>
);
