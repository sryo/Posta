import { For, Show } from "solid-js";
import type { CadenceNotice } from "../app/cadence";
import { shortName } from "../app/people";
import { CloseIcon } from "./Icons";

// One quiet line per fact about the mail a card is missing, at its foot,
// with the obvious next step and a way to hide it until next month
export function CardFootNotes(props: { notices: CadenceNotice[]; onSearch: (query: string) => void; onDismiss: (email: string) => void }) {
  return (
    <Show when={props.notices.length > 0}>
      <div class="card-foot-notes">
        <For each={props.notices}>
          {(notice) => (
            <p class="card-foot-note">
              <span class="card-foot-note-text">{notice.text}</span>
              <button type="button" class="card-foot-note-action" aria-label={`Search for ${shortName(notice.sender)}'s mail`} onClick={() => props.onSearch(notice.query)}>
                Search
              </button>
              <button type="button" class="card-foot-note-dismiss" aria-label={`Hide ${shortName(notice.sender)} until next month`} title="Hide until next month" onClick={() => props.onDismiss(notice.email)}>
                <CloseIcon size="meta" />
              </button>
            </p>
          )}
        </For>
      </div>
    </Show>
  );
}
