import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { ContactOption, type RecipientSuggestion } from "./RecipientInput";
import { Chip } from "./Chip";
import { extractEmail, extractName, splitEmailList } from "../utils";
import { isImeComposing } from "../shared/keyboard";

type Contact = RecipientSuggestion;

// The text split at commas and semicolons outside a quoted name or
// <address>; the last piece is what follows the last separator
function splitAtSeparators(text: string): string[] {
  const pieces = [""];
  let quoted = false;
  let angled = false;
  for (const ch of text) {
    if (ch === '"' && !angled) quoted = !quoted;
    else if (ch === "<" && !quoted) angled = true;
    else if (ch === ">" && !quoted) angled = false;
    else if ((ch === "," || ch === ";") && !quoted && !angled) {
      pieces.push("");
      continue;
    }
    pieces[pieces.length - 1] += ch;
  }
  return pieces;
}

const asRecipient = (c: Contact) => (c.name ? `"${c.name.replace(/"/g, "")}" <${c.email}>` : c.email);

// An event's guests as chips, with the compose field's contact suggestions.
// The value stays the comma-separated list the rest of the form reads.
export const GuestChips = (props: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
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

  const addAll = (recipients: string[]) => {
    const added: string[] = [];
    for (const r of recipients) {
      const email = extractEmail(r).toLowerCase();
      if (!has(email) && !added.some(a => extractEmail(a).toLowerCase() === email)) added.push(r);
    }
    if (added.length) props.onChange([...guests(), ...added].join(", "));
  };

  const add = (recipient: string) => {
    addAll([recipient]);
    setText("");
    setShowList(false);
  };

  // A pasted list becomes chips up to its last separator; what follows it
  // stays in the field to finish typing. Text with a piece that isn't an
  // address stays as it is, rather than losing that piece.
  const handleInput = (input: HTMLInputElement) => {
    const pieces = splitAtSeparators(input.value);
    const complete = pieces.slice(0, -1).map(p => p.trim()).filter(p => p);
    let typed = input.value;
    if (complete.length && complete.every(p => p.includes("@"))) {
      addAll(complete);
      typed = pieces[pieces.length - 1].trimStart();
      input.value = typed;
    }
    setText(typed);
    setActive(0);
    setShowList(true);
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
            <Chip class="guest-chip" title={email} removeLabel={`Remove ${label}`} onRemove={() => remove(i())}>
              {label}
            </Chip>
          );
        }}
      </For>
      <input
        type="text"
        id={props.id}
        class="guest-chips-input"
        role="combobox"
        aria-label="Guests"
        aria-expanded={listOpen()}
        aria-controls={listId}
        aria-autocomplete="list"
        autocomplete="off"
        placeholder={guests().length ? "" : "Add guests"}
        value={text()}
        onInput={(e) => handleInput(e.currentTarget)}
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
                <ContactOption contact={contact} />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
