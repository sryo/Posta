import { For } from "solid-js";
import type { RecurrenceScope } from "../app/recurrence";
import { Menu } from "./Menu";

export type { RecurrenceScope };

const SCOPES: { scope: RecurrenceScope; label: string }[] = [
  { scope: "this", label: "This event" },
  { scope: "following", label: "This and following" },
  { scope: "all", label: "All events" },
];

// Asks which occurrences of a repeating event a save or delete applies to;
// positioned by its parent, next to the button that opened it
export const ScopeMenu = (props: {
  title: string;
  onChoose: (scope: RecurrenceScope) => void;
  onCancel: () => void;
}) => (
  <Menu class="scope-menu" label={props.title} title={props.title} onClose={props.onCancel}>
    <For each={SCOPES}>
      {(option) => (
        <button type="button" class="menu-item" role="menuitem" onClick={() => props.onChoose(option.scope)}>
          {option.label}
        </button>
      )}
    </For>
  </Menu>
);
