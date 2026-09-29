import { For, Show } from "solid-js";
import { CheckIcon } from "./Icons";
import { RSVP_ANSWERS, type RsvpStatus } from "../app/rsvp";

// The user's answer to an invite, as one segmented control shared by invite
// rows, the opened invite email and the event view
export const RsvpControl = (props: {
  value: string | null | undefined;
  onAnswer: (status: RsvpStatus) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  showKeys?: boolean;
}) => (
  <div
    class="rsvp-control"
    classList={{ "rsvp-control-sm": props.size === "sm", "rsvp-control-md": props.size !== "sm" }}
    role="group"
    aria-label="Your response"
    onClick={(e) => e.stopPropagation()}
  >
    <For each={RSVP_ANSWERS}>
      {(answer) => {
        const selected = () => props.value === answer.status;
        return (
          <button
            type="button"
            class="rsvp-segment"
            classList={{
              "rsvp-success": answer.tone === "success",
              "rsvp-warning": answer.tone === "warning",
              "rsvp-danger": answer.tone === "danger",
              selected: selected(),
            }}
            aria-label={answer.label}
            aria-pressed={selected()}
            aria-keyshortcuts={props.showKeys ? answer.ariaKey : undefined}
            disabled={props.disabled}
            onClick={() => { if (!selected()) props.onAnswer(answer.status); }}
          >
            <Show when={selected()}>
              <span class="rsvp-check" aria-hidden="true"><CheckIcon size="meta" strong /></span>
            </Show>
            {answer.label}
            <Show when={props.showKeys}>
              <span class="shortcut-hint" aria-hidden="true">{answer.keyHint}</span>
            </Show>
          </button>
        );
      }}
    </For>
  </div>
);
