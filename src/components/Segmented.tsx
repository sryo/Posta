import { For, Show, type JSX } from "solid-js";
import { CheckIcon } from "./Icons";

export interface Segment<T> {
  value: T;
  label: JSX.Element;
  // Names the segment when its label alone doesn't (a label with a key hint)
  name?: string;
  // Fills the chosen segment in a status colour (divided look only)
  tone?: "success" | "warning" | "danger";
  ariaKey?: string;
}

// A choice of one among a few, shown side by side, in one of two looks:
//   raised   quiet, the chosen one lifted on a card (a card's grouping)
//   divided  outlined and ruled, the chosen one filled in its tone and
//            marked with a check (an invite's answer), sm or md
// A segment's click stays in the control, so a row or card around it
// doesn't open too.
export function Segmented<T>(props: {
  label: string;
  options: readonly Segment<T>[];
  value: T | null | undefined;
  onChange: (value: T) => void;
  look?: "raised" | "divided";
  size?: "sm" | "md";
  disabled?: boolean;
  // Leaves the chosen segment be when pressed again, instead of choosing it anew
  keepChosen?: boolean;
}) {
  const look = () => props.look ?? "raised";
  return (
    <div
      class="segmented"
      data-look={look()}
      data-size={props.size ?? "sm"}
      role="group"
      aria-label={props.label}
      onClick={(e) => e.stopPropagation()}
    >
      <For each={props.options}>
        {(option) => {
          const chosen = () => props.value === option.value;
          return (
            <button
              type="button"
              class="segment"
              data-tone={option.tone}
              aria-label={option.name}
              aria-pressed={chosen()}
              aria-keyshortcuts={option.ariaKey}
              disabled={props.disabled}
              onClick={() => { if (!(props.keepChosen && chosen())) props.onChange(option.value); }}
            >
              <Show when={look() === "divided" && chosen()}>
                <span class="segment-check" aria-hidden="true"><CheckIcon size="meta" strong /></span>
              </Show>
              {option.label}
            </button>
          );
        }}
      </For>
    </div>
  );
}
