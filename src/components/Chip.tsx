import { Show, type JSX } from "solid-js";
import { CloseIcon } from "./Icons";

// A token inside a field, with ✕ to take it out: a guest in the event form,
// an operator in a query. With `action` its label is a button too, such as
// to change the operator; `removeProps` lets the field keep its focus.
export function Chip(props: {
  children: JSX.Element;
  removeLabel: string;
  onRemove: () => void;
  action?: JSX.ButtonHTMLAttributes<HTMLButtonElement>;
  removeProps?: JSX.ButtonHTMLAttributes<HTMLButtonElement>;
  class?: string;
  classList?: Record<string, boolean>;
  title?: string;
}) {
  return (
    <span class={`chip${props.class ? ` ${props.class}` : ""}`} classList={props.classList} title={props.title}>
      <Show when={props.action} fallback={<span class="chip-label">{props.children}</span>}>
        {(action) => <button type="button" {...action()} class="chip-label">{props.children}</button>}
      </Show>
      <button
        type="button"
        {...props.removeProps}
        class="chip-remove"
        aria-label={props.removeLabel}
        onClick={() => props.onRemove()}
      >
        <CloseIcon size="meta" />
      </button>
    </span>
  );
}
