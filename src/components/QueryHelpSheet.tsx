import { For } from "solid-js";
import { CloseButton } from "./ComposeAtoms";
import { Dialog } from "./Dialog";

// `insert` is what a row puts into the query when it is clicked, where the
// row's example value is only a placeholder
type Row = { code: string; desc: string; insert?: string };

const EMAIL_ROWS: Row[] = [
  { code: "from:", desc: "Sender email or name" },
  { code: "to:", desc: "Recipient email" },
  { code: "subject:", desc: "Words in subject" },
  { code: "label:", desc: "Gmail label (e.g., label:inbox)" },
  { code: "is:unread", desc: "Unread messages" },
  { code: "is:starred", desc: "Starred messages" },
  { code: "has:attachment", desc: "Has attachments" },
  { code: "newer_than:7d", desc: "Last 7 days (d/m/y)" },
  { code: "older_than:1m", desc: "Older than 1 month" },
  { code: "-word", desc: "Leave out emails containing word", insert: "-" },
];

const CALENDAR_ROWS: Row[] = [
  { code: "calendar:today", desc: "Today's events" },
  { code: "calendar:tomorrow", desc: "Tomorrow's events" },
  { code: "calendar:week", desc: "Next 7 days" },
  { code: "calendar:7d", desc: "Next 7 days, from now" },
  { code: "calendar:2w", desc: "Next 2 weeks" },
  { code: "calendar:month", desc: "Next 30 days" },
  { code: "with:name", desc: "Attendee name/email", insert: "with:" },
  { code: "organizer:email", desc: "Event organizer", insert: "organizer:" },
  { code: "location:text", desc: "Event location", insert: "location:" },
  { code: "response:needsAction", desc: "Needs RSVP" },
  { code: "-keyword", desc: "Leave out events containing word", insert: "-" },
];

const EXAMPLES = [
  "from:boss is:unread",
  "label:inbox newer_than:1d",
  "has:attachment -newsletter",
  "calendar:week with:john",
  "calendar:today response:needsAction",
];

export const QueryHelpSheet = (props: { onInsert: (text: string) => void; onClose: () => void }) => {
  const pick = (text: string) => {
    props.onClose();
    props.onInsert(text);
  };
  const rows = (list: Row[]) => (
    <div class="query-help-table">
      <For each={list}>
        {(row) => (
          <button type="button" class="query-help-row" onClick={() => pick(row.insert ?? row.code)}>
            <code>{row.code}</code>
            <span>{row.desc}</span>
          </button>
        )}
      </For>
    </div>
  );

  return (
    <>
      <div class="query-help-overlay" onClick={props.onClose}></div>
      <Dialog
        class="query-help-sheet"
        labelledBy="query-help-title"
        onClose={props.onClose}
        initialFocus={(el) => el.querySelector<HTMLElement>(".query-help-body")}
      >
        <div class="query-help-header">
          <h3 id="query-help-title">Query Operators</h3>
          <CloseButton onClick={props.onClose} />
        </div>
        <div class="query-help-body" tabindex="0">
          <p class="query-help-note">Click an operator to add it to the query.</p>
          <div class="query-help-section">
            <h4>Email Operators</h4>
            {rows(EMAIL_ROWS)}
          </div>
          <div class="query-help-section">
            <h4>Calendar Operators</h4>
            <p class="query-help-note">Start query with <code>calendar:</code> to create a calendar card</p>
            {rows(CALENDAR_ROWS)}
          </div>
          <div class="query-help-section">
            <h4>Examples</h4>
            <div class="query-help-examples">
              <For each={EXAMPLES}>{(example) => <code>{example}</code>}</For>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
};
