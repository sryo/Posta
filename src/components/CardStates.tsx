import { createMemo, For, Index, Show } from "solid-js";
import type { ConnectionStatus } from "../app/connectionStatus";
import {
  cancellationStyle,
  emptyLabel,
  emptyLine,
  ringFontSize,
  ringText,
  stampClock,
  stampDate,
  stampTilt,
  type EmptyKind,
  type PostmarkLedger,
} from "../app/postmark";
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

type CardEmptyProps = {
  cardId: string;
  name: string;
  query: string;
  kind: EmptyKind;
  // While a query is being tried out, empty means it matches nothing
  plain: boolean;
  ledger: PostmarkLedger;
  locale?: string;
};

export const CardEmpty = (props: CardEmptyProps) => (
  <Show
    when={!props.plain}
    fallback={
      <div class="empty">
        <span class="empty-icon"><InboxIcon size="tool" /></span>
        <span>Nothing matches <code class="empty-query">{props.query}</code></span>
      </div>
    }
  >
    <Postmarked {...props} />
  </Show>
);

// Cancellation lines to the right of the ring, one per row
const CANCEL_ROWS: [x: number, y: number][] = [[78, 20], [80, 29], [81, 38], [80, 47], [78, 56]];

const Postmarked = (props: CardEmptyProps) => {
  const stamp = createMemo(() => props.ledger.emptied(props.cardId, props.query));
  const clock = () => stampClock(stamp().clearedAt, props.locale);
  const ring = () => ringText(props.name);
  return (
    <div class="empty postmarked" role="status" aria-label={emptyLabel(props.name, stamp().clearedAt, props.query, props.locale)}>
      <svg
        class={stamp().lands ? "postmark lands" : "postmark"}
        style={{ "--tilt": `${stampTilt(props.cardId)}deg` }}
        viewBox="0 0 168 76"
        aria-hidden="true"
      >
        <g filter="url(#postmark-ink)" fill="none" stroke="currentColor">
          <circle cx="40" cy="38" r="32" stroke-width="1.8" />
          <circle cx="40" cy="38" r="20.5" stroke-width="1.1" />
          <Show
            when={cancellationStyle(stamp().clearedAt) === "waves"}
            fallback={
              <g stroke-width="2.4" stroke-linecap="butt">
                <Index each={CANCEL_ROWS}>{(row) => <path d={`M${row()[0] + 1} ${row()[1] + 2} H164`} />}</Index>
              </g>
            }
          >
            <g stroke-width="1.6" stroke-linecap="round">
              <Index each={CANCEL_ROWS}>{(row) => <path d={`M${row()[0]} ${row()[1]} q 7 -5 14 0 t 14 0 t 14 0 t 14 0 t 14 0 t 14 0`} />}</Index>
            </g>
          </Show>
          <g class="postmark-text" fill="currentColor" stroke="none">
            <text font-size={String(ringFontSize(ring()))} text-anchor="middle">
              <textPath href="#postmark-ring-top" startOffset="50%">{ring()}</textPath>
            </text>
            <text font-size="7" text-anchor="middle">
              <textPath href="#postmark-ring-bottom" startOffset="50%">{stampDate(stamp().clearedAt)}</textPath>
            </text>
            <text x="40" y={clock().meridiem ? "40.5" : "42"} font-size="11" text-anchor="middle" letter-spacing="0.2" class="postmark-clock">{clock().time}</text>
            <Show when={clock().meridiem}>
              {(meridiem) => <text x="40" y="48.5" font-size="5.5" text-anchor="middle" letter-spacing="1">{meridiem()}</text>}
            </Show>
          </g>
        </g>
      </svg>
      <span class="empty-line">{emptyLine(props.kind, props.cardId, props.query, stamp().clearedAt)}</span>
      <code class="empty-query">{props.query}</code>
    </div>
  );
};

// The rubber-stamp ink and the ring's text arcs, shared by every card's
// postmark; mounted once
export const PostmarkDefs = () => (
  <svg class="postmark-defs" aria-hidden="true">
    <defs>
      {/* A little edge wobble plus a few dry specks */}
      <filter id="postmark-ink" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="4" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.3" result="wobble" />
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 1.85" result="specks" />
        <feComposite in="wobble" in2="specks" operator="in" />
      </filter>
      <path id="postmark-ring-top" d="M 16.5,38 A 23.5,23.5 0 0 1 63.5,38" />
      <path id="postmark-ring-bottom" d="M 11.5,38 A 28.5,28.5 0 0 0 68.5,38" />
    </defs>
  </svg>
);

// The board-wide strip saying why cards can't update, docked above the deck.
// Its live region stays on the page so the first message is announced too.
export const ConnectionStatusBar = (props: { status: ConnectionStatus | null; onRetry: () => void; onSignIn: () => void }) => (
  <div class="connection-status-region" aria-live="polite">
    <Show when={props.status}>
      {(status) => (
        <div class={`connection-status ${status().kind}`}>
          <Show when={status().kind === "reconnecting"}>
            <span class="spinner-sm"></span>
          </Show>
          <span class="connection-status-message">{status().message}</span>
          <Show when={status().action === "retry"}>
            <button type="button" class="connection-status-action" onClick={() => props.onRetry()}>Try now</button>
          </Show>
          <Show when={status().action === "signIn"}>
            <button type="button" class="connection-status-action" onClick={() => props.onSignIn()}>Sign in again</button>
          </Show>
        </div>
      )}
    </Show>
  </div>
);
