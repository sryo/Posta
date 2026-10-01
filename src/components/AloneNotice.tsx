import { Show } from "solid-js";
import { aloneText, type Alone } from "../app/attendance";

// An event's row saying everyone else declined. The organizer can move the
// event or call it off from there; the row itself still opens the event.
export function AloneNotice(props: { alone: Alone; title: string; onReschedule?: () => void; onCancel?: () => void }) {
  // The row opens on click and on Enter or Space
  const keepFromRow = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); };
  return (
    <div class="calendar-event-alone">
      <span>{aloneText(props.alone)}</span>
      <Show when={props.onReschedule}>
        {(reschedule) => (
          <button
            class="calendar-event-alone-action"
            aria-label={`Reschedule ${props.title}`}
            on:keydown={keepFromRow}
            onClick={(e) => { e.stopPropagation(); reschedule()(); }}
          >
            Reschedule
          </button>
        )}
      </Show>
      <Show when={props.onCancel}>
        {(cancel) => (
          <button
            class="calendar-event-alone-action danger"
            aria-label={`Cancel ${props.title}`}
            on:keydown={keepFromRow}
            onClick={(e) => { e.stopPropagation(); cancel()(); }}
          >
            Cancel event
          </button>
        )}
      </Show>
    </div>
  );
}
