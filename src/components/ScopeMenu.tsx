import { For, onCleanup, onMount } from "solid-js";
import type { RecurrenceScope } from "../app/recurrence";

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
}) => {
  let menu: HTMLDivElement | undefined;
  const items = () => Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  const handleKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      props.onCancel();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const all = items();
      const i = all.indexOf(document.activeElement as HTMLElement);
      all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
    }
  };

  const dismissOutside = (e: MouseEvent) => {
    if (menu && !menu.contains(e.target as Node)) props.onCancel();
  };

  onMount(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = setTimeout(() => items()[0]?.focus(), 0);
    document.addEventListener("mousedown", dismissOutside);
    onCleanup(() => {
      clearTimeout(focusTimer);
      document.removeEventListener("mousedown", dismissOutside);
      if (opener?.isConnected && menu?.contains(document.activeElement)) opener.focus();
    });
  });

  return (
    <div ref={menu} class="scope-menu" role="menu" aria-label={props.title} on:keydown={handleKeyDown}>
      <div class="scope-menu-title" aria-hidden="true">{props.title}</div>
      <For each={SCOPES}>
        {(option) => (
          <button type="button" class="scope-menu-item" role="menuitem" onClick={() => props.onChoose(option.scope)}>
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
};
