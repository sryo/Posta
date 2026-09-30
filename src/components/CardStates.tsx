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

// Why a card that could show mail shows none:
//   query   the query being edited finds nothing
//   search  Gmail found nothing for what was searched from the / bar
//   filter  none of the card's loaded threads contain what is being typed
export type NoMatch =
  | { kind: "query" }
  | { kind: "search"; term: string }
  | { kind: "filter"; term: string; onSearch: () => void; onClear: () => void };

type CardEmptyProps = {
  cardId: string;
  name: string;
  query: string;
  kind: EmptyKind;
  noMatch: NoMatch | null;
  ledger: PostmarkLedger;
  locale?: string;
};

export const CardEmpty = (props: CardEmptyProps) => (
  <Show when={props.noMatch} fallback={<Postmarked {...props} />}>
    {(noMatch) => <ReturnedToSender name={props.name} query={props.query} noMatch={noMatch()} />}
  </Show>
);

// Nothing matched: the post office's boxed "Return to sender" handstamp, in
// the same ink as the postmark but square and straight, so it never reads as
// an emptied card. Narrow cards get a magnifier over a "0 found" stamp.
const ReturnedToSender = (props: { name: string; query: string; noMatch: NoMatch }) => {
  const term = () => (props.noMatch.kind === "query" ? props.query : props.noMatch.term);
  const label = () => {
    const nm = props.noMatch;
    if (nm.kind === "query") return `No mail matches ${props.query}`;
    if (nm.kind === "search") return `Gmail has nothing for ${nm.term}`;
    return `Nothing loaded in ${props.name} matches ${nm.term}`;
  };
  return (
    <div class="empty returned" role="status" aria-label={label()}>
      <svg class="postmark returned-wide" viewBox="0 0 168 76" aria-hidden="true">
        <g filter="url(#postmark-ink)" fill="none" stroke="currentColor">
          <rect x="4" y="6" width="160" height="64" rx="3" stroke-width="1.8" />
          <rect x="8" y="10" width="152" height="56" rx="1.5" stroke-width="0.9" />
          <path d="M40 48 H24 a9 9 0 0 1 0 -18 H38" stroke-width="2.2" stroke-linecap="round" />
          <path d="M33 24.5 L39 30 L33 35.5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M48 16 V60" stroke-width="0.9" />
          <g class="postmark-text" fill="currentColor" stroke="none">
            <text x="106" y="27" font-size="9.5" text-anchor="middle">RETURN TO</text>
            <text x="106" y="38" font-size="9.5" text-anchor="middle">SENDER</text>
            <text x="66" y="51" font-size="5.6" letter-spacing="1">MOVED</text>
            <text x="66" y="60" font-size="5.6" letter-spacing="1">NO SUCH ADDRESS</text>
          </g>
          <rect x="56" y="46" width="5" height="5" stroke-width="0.9" />
          <rect x="56" y="55" width="5" height="5" stroke-width="0.9" />
          <path d="M55 54 L62.5 61.5 M62.5 54 L55 61.5" stroke-width="1.4" stroke-linecap="round" />
        </g>
      </svg>
      <svg class="postmark returned-narrow" viewBox="0 0 120 76" aria-hidden="true">
        <g filter="url(#postmark-ink)" fill="none" stroke="currentColor">
          <rect x="18" y="8" width="46" height="58" stroke-width="3.2" stroke-dasharray="0 4.6" stroke-linecap="round" />
          <rect x="23" y="13" width="36" height="48" stroke-width="1" />
          <rect x="27" y="17" width="28" height="30" stroke-width="0.8" stroke-dasharray="1.5 2" />
          <g class="postmark-text" fill="currentColor" stroke="none">
            <text x="28" y="57" font-size="9">0</text>
            <text x="55" y="57" font-size="4.6" letter-spacing="1" text-anchor="end">FOUND</text>
          </g>
          <circle cx="74" cy="34" r="17" stroke-width="2" />
          <circle cx="74" cy="34" r="13.5" stroke-width="0.8" />
          <path d="M86.5 46.5 L103 63" stroke-width="5" stroke-linecap="round" />
          <path d="M66 26 a11 11 0 0 1 8 -3.5" stroke-width="1.2" stroke-linecap="round" />
        </g>
      </svg>
      <span class="empty-line">
        <Show when={props.noMatch.kind === "query"}>No such address.</Show>
        <Show when={props.noMatch.kind === "search"}>Gmail has nothing for <code class="empty-query">{term()}</code></Show>
        <Show when={props.noMatch.kind === "filter"}>Nothing loaded for <code class="empty-query">{term()}</code></Show>
      </span>
      <Show when={props.noMatch.kind === "query"}>
        <code class="empty-query">{term()}</code>
      </Show>
      <Show when={props.noMatch.kind === "filter" && props.noMatch}>
        {(nm) => (
          <span class="returned-actions">
            <button type="button" class="link-btn" onClick={() => nm().onSearch()}>Search all mail</button>
            <button type="button" class="link-btn" onClick={() => nm().onClear()}>Clear filter</button>
          </span>
        )}
      </Show>
    </div>
  );
};

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
