import { createMemo, createSignal, For, Show } from "solid-js";
import { Avatar } from "./Avatar";
import { completeRecipient, currentRecipient } from "../app/contacts";
import { isImeComposing } from "../shared/keyboard";

export interface RecipientSuggestion {
  email: string;
  name?: string;
  // Shown under the address, such as why it ranks where it does
  note?: string;
}

// A suggested contact as a listbox option shows it
export const ContactOption = (props: { contact: RecipientSuggestion }) => (
  <>
    <Avatar email={props.contact.email} name={props.contact.name} size="sm" />
    <div class="compose-autocomplete-info">
      <Show when={props.contact.name}>
        <div class="compose-autocomplete-name">{props.contact.name}</div>
      </Show>
      <div class="compose-autocomplete-email">{props.contact.email}</div>
      <Show when={props.contact.note}>
        <div class="compose-autocomplete-note">{props.contact.note}</div>
      </Show>
    </div>
  </>
);

// A To/Cc/Bcc field that suggests contacts for the recipient being typed, as
// an ARIA combobox. Keys it doesn't use for the suggestions go to onKeyDown.
export const RecipientInput = (props: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  suggest?: (query: string) => RecipientSuggestion[];
  placeholder?: string;
  onKeyDown?: (e: KeyboardEvent) => void;
  inputRef?: (el: HTMLInputElement) => void;
}) => {
  const listId = `${props.id}-suggestions`;
  const optionId = (i: number) => `${props.id}-suggestion-${i}`;
  const [focused, setFocused] = createSignal(false);
  const [dismissed, setDismissed] = createSignal(false);
  const [active, setActive] = createSignal(0);

  const query = () => currentRecipient(props.value);
  const candidates = createMemo(() => (props.suggest && query() ? props.suggest(query()) : []));
  const open = () => focused() && !dismissed() && candidates().length > 0;

  function commit(email: string) {
    props.onChange(completeRecipient(props.value, email));
    setDismissed(true);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (isImeComposing(e)) return;
    if (open()) {
      const count = candidates().length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive(i => (i + (e.key === "ArrowDown" ? 1 : -1) + count) % count);
        return;
      }
      if ((e.key === "Enter" && !(e.metaKey || e.ctrlKey)) || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        commit(candidates()[Math.min(active(), count - 1)].email);
        return;
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        setDismissed(true);
        return;
      }
    }
    props.onKeyDown?.(e);
  }

  return (
    <>
      <input
        ref={el => props.inputRef?.(el)}
        id={props.id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open()}
        aria-controls={open() ? listId : undefined}
        aria-activedescendant={open() ? optionId(active()) : undefined}
        autocomplete="off"
        value={props.value}
        onInput={e => {
          setDismissed(false);
          setActive(0);
          props.onChange(e.currentTarget.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        placeholder={props.placeholder}
      />
      <Show when={open()}>
        <div class="compose-autocomplete" role="listbox" id={listId}>
          <For each={candidates()}>
            {(contact, i) => (
              <div
                id={optionId(i())}
                role="option"
                aria-selected={i() === active()}
                class={`compose-autocomplete-item ${i() === active() ? "selected" : ""}`}
                onMouseDown={e => {
                  e.preventDefault();
                  commit(contact.email);
                }}
                onMouseEnter={() => setActive(i())}
              >
                <ContactOption contact={contact} />
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  );
};
