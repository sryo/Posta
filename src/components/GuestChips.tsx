import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { extractEmail, extractName, getAvatarColor, splitEmailList } from "../utils";
import { CloseIcon } from "./Icons";
import { isImeComposing } from "../shared/keyboard";

type Contact = { email: string; name?: string };

const asRecipient = (c: Contact) => (c.name ? `"${c.name.replace(/"/g, "")}" <${c.email}>` : c.email);

// An event's guests as chips, with the compose field's contact suggestions.
// The value stays the comma-separated list the rest of the form reads.
export const GuestChips = (props: {
  value: string;
  onChange: (value: string) => void;
  suggest?: (query: string) => Contact[];
}) => {
  const listId = createUniqueId();
  const [text, setText] = createSignal("");
  const [active, setActive] = createSignal(0);
  const [showList, setShowList] = createSignal(false);

  const guests = () => splitEmailList(props.value);
  const has = (email: string) => guests().some(g => extractEmail(g).toLowerCase() === email.toLowerCase());

  const suggestions = createMemo(() => {
    const q = text().trim();
    if (!q || !props.suggest) return [];
    return props.suggest(q).filter(c => !has(c.email)).slice(0, 8);
  });
  const listOpen = () => showList() && suggestions().length > 0;

  const add = (recipient: string) => {
    if (!has(extractEmail(recipient))) props.onChange([...guests(), recipient].join(", "));
    setText("");
    setShowList(false);
  };

  const remove = (index: number) => props.onChange(guests().filter((_, i) => i !== index).join(", "));

  // The typed text becomes a guest when it is an address
  const commitTyped = () => {
    const typed = text().trim().replace(/,$/, "");
    if (typed.includes("@")) add(typed);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (isImeComposing(e)) return;
    if (listOpen() && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const n = suggestions().length;
      setActive(i => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
      return;
    }
    if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (listOpen()) add(asRecipient(suggestions()[active()]));
      else commitTyped();
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      commitTyped();
      return;
    }
    if (e.key === ",") {
      e.preventDefault();
      commitTyped();
      return;
    }
    if (e.key === "Backspace" && !text() && guests().length > 0) {
      remove(guests().length - 1);
      return;
    }
    if (e.key === "Escape" && listOpen()) {
      e.stopPropagation();
      setShowList(false);
    }
  };

  return (
    <div class="guest-chips">
      <For each={guests()}>
        {(guest, i) => {
          const email = extractEmail(guest);
          const label = extractName(guest) ?? email;
          return (
            <span class="guest-chip" title={email}>
              <span class="guest-chip-label">{label}</span>
              <button type="button" class="guest-chip-remove" aria-label={`Remove ${label}`} onClick={() => remove(i())}>
                <CloseIcon />
              </button>
            </span>
          );
        }}
      </For>
      <input
        type="text"
        class="guest-chips-input"
        role="combobox"
        aria-label="Guests"
        aria-expanded={listOpen()}
        aria-controls={listId}
        aria-autocomplete="list"
        autocomplete="off"
        placeholder={guests().length ? "" : "Add guests"}
        value={text()}
        onInput={(e) => { setText(e.currentTarget.value); setActive(0); setShowList(true); }}
        onKeyDown={handleKeyDown}
        onBlur={() => { commitTyped(); setShowList(false); }}
      />
      <Show when={listOpen()}>
        <div id={listId} class="compose-autocomplete" role="listbox" aria-label="Guest suggestions">
          <For each={suggestions()}>
            {(contact, i) => (
              <div
                class={`compose-autocomplete-item ${i() === active() ? "selected" : ""}`}
                role="option"
                aria-selected={i() === active()}
                onMouseDown={(e) => { e.preventDefault(); add(asRecipient(contact)); }}
                onMouseEnter={() => setActive(i())}
              >
                <div class="compose-autocomplete-avatar" style={{ background: getAvatarColor(contact.name || contact.email) }}>
                  {(contact.name || contact.email).charAt(0).toUpperCase()}
                </div>
                <div class="compose-autocomplete-info">
                  <Show when={contact.name}>
                    <div class="compose-autocomplete-name">{contact.name}</div>
                  </Show>
                  <div class="compose-autocomplete-email">{contact.email}</div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
