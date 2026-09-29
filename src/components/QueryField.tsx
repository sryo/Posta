import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { CALENDAR_RANGES, GMAIL_OPERATORS } from "../shared/constants";
import { matchContacts, type RecentContact } from "../app/contacts";
import { labelQueryValue, type QuerySuggestion } from "../app/querySuggestions";
import { describeQuery, operatorText, queryWords, removeWord, replaceWord, type QueryWord } from "../app/queryTokens";
import { isImeComposing } from "../shared/keyboard";

const ADDRESS_OPERATORS = new Set(["from", "to", "cc", "bcc", "deliveredto", "with", "organizer"]);

const PERIODS = [
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "2w", label: "2 weeks" },
  { value: "1m", label: "1 month" },
  { value: "1y", label: "1 year" },
];

const RESPONSES = [
  { value: "needsAction", label: "Not answered" },
  { value: "accepted", label: "Going" },
  { value: "tentative", label: "Maybe" },
  { value: "declined", label: "Not going" },
];

// The fixed values an operator's picker offers, for operators with a known set
function fixedChoices(op: string): { value: string; label: string }[] {
  if (op === "newer_than" || op === "older_than") return PERIODS;
  if (op === "response") return RESPONSES;
  if (op === "calendar") return CALENDAR_RANGES.map(r => ({ value: r.op.slice("calendar:".length), label: r.desc }));
  return GMAIL_OPERATORS
    .filter(o => o.op.startsWith(`${op}:`) && o.op.length > op.length + 1)
    .map(o => ({ value: o.op.slice(op.length + 1), label: o.desc }));
}

type Rect = { top: number; left: number; width: number };
const below = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.bottom + 4, left: r.left, width: r.width };
};

// A card query field: at rest, recognised operators show as chips that
// open a picker and plain words stay text; while focused it is the raw
// query, with autocomplete for the word at the caret
export const QueryField = (props: {
  query: string;
  setQuery: (query: string) => void;
  suggest: (query: string, caret: number) => QuerySuggestion[];
  contacts: RecentContact[];
  labelNames: string[];
  onSave: () => void;
  onCancel: () => void;
  // Receives the function that inserts text at this field's caret, whenever
  // the field appears or gains focus
  onActive?: (insert: (text: string) => void) => void;
}) => {
  let input!: HTMLInputElement;
  const [editing, setEditing] = createSignal(false);
  const [caret, setCaret] = createSignal(props.query.length);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [menuIndex, setMenuIndex] = createSignal(0);
  const [menuPos, setMenuPos] = createSignal<Rect | null>(null);
  const [picker, setPicker] = createSignal<{ index: number; pos: Rect } | null>(null);
  const [pickerFilter, setPickerFilter] = createSignal("");

  const words = createMemo(() => queryWords(props.query));
  const explanation = createMemo(() => describeQuery(props.query));
  const suggestions = createMemo(() => (editing() && menuOpen() ? props.suggest(props.query, caret()) : []));

  const contactName = (email: string) => props.contacts.find(c => c.email.toLowerCase() === email.toLowerCase())?.name;
  const chipValue = (word: QueryWord) => {
    const op = word.operator!;
    return (ADDRESS_OPERATORS.has(op.op) && contactName(op.value)) || op.value;
  };

  function readCaret() {
    setCaret(input.selectionStart ?? input.value.length);
  }

  function openMenu() {
    readCaret();
    setMenuIndex(0);
    setMenuOpen(true);
    setMenuPos(below(input));
  }

  function setQueryAndCaret(query: string, at: number) {
    props.setQuery(query);
    input.setSelectionRange(at, at);
    setCaret(at);
  }

  function applySuggestion(suggestion: QuerySuggestion) {
    const before = props.query.slice(0, suggestion.replace.start);
    const after = props.query.slice(suggestion.replace.end).replace(/^\s+/, "");
    const text = suggestion.text + (suggestion.text.endsWith(":") ? "" : " ");
    input.focus();
    setQueryAndCaret(before + text + after, before.length + text.length);
    setMenuOpen(false);
  }

  function insert(text: string) {
    const at = Math.min(caret(), props.query.length);
    const before = props.query.slice(0, at);
    const after = props.query.slice(at);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const trail = after && !/^\s/.test(after) ? " " : "";
    input.focus();
    setQueryAndCaret(before + lead + text + trail + after, before.length + lead.length + text.length);
  }

  onMount(() => props.onActive?.(insert));

  // Where each word starts in the raw query, for putting the caret after it
  function wordEnd(index: number): number {
    let pos = 0;
    for (const [i, word] of words().entries()) {
      pos = props.query.indexOf(word.text, pos);
      if (i === index) return pos + word.text.length;
      pos += word.text.length;
    }
    return props.query.length;
  }

  function closePicker() {
    setPicker(null);
    setPickerFilter("");
  }

  function choose(index: number, value: string) {
    const op = words()[index].operator!;
    props.setQuery(replaceWord(props.query, index, operatorText(op.op, value, op.negated)));
    closePicker();
  }

  function editAsText(index: number) {
    closePicker();
    const at = wordEnd(index);
    input.focus();
    input.setSelectionRange(at, at);
    setCaret(at);
  }

  createEffect(() => {
    if (!menuOpen() && !picker()) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".query-picker")) closePicker();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !picker()) return;
      e.stopPropagation();
      closePicker();
    };
    const reposition = () => {
      if (menuOpen()) setMenuPos(below(input));
    };
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    });
  });

  const pickerWord = () => {
    const p = picker();
    return p ? words()[p.index] : undefined;
  };

  return (
    <>
      <div class="query-field" classList={{ editing: editing() || words().length === 0 }}>
        <input
          type="text"
          ref={input}
          value={props.query}
          aria-label="Query"
          placeholder="e.g. from:boss is:unread newer_than:7d"
          onInput={(e) => {
            props.setQuery(e.currentTarget.value);
            openMenu();
          }}
          onFocus={() => {
            setEditing(true);
            props.onActive?.(insert);
            openMenu();
          }}
          onBlur={() => {
            setEditing(false);
            setMenuOpen(false);
          }}
          onSelect={() => { readCaret(); }}
          onClick={() => { readCaret(); }}
          onKeyUp={(e) => { if (e.key.startsWith("Arrow") && !suggestions().length) readCaret(); }}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            const list = suggestions();
            if (e.key === "Escape") {
              if (list.length > 0) setMenuOpen(false);
              else props.onCancel();
              return;
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              props.onSave();
              return;
            }
            if (list.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setMenuIndex((menuIndex() + 1) % list.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setMenuIndex((menuIndex() - 1 + list.length) % list.length);
            } else if (e.key === "Enter" || e.key === "Tab") {
              const chosen = list[menuIndex()];
              if (chosen) {
                e.preventDefault();
                applySuggestion(chosen);
              }
            }
          }}
        />
        <Show when={!editing() && words().length > 0}>
          <div
            class="query-chips"
            onMouseDown={(e) => {
              if (e.target !== e.currentTarget) return;
              e.preventDefault();
              input.focus();
              input.setSelectionRange(props.query.length, props.query.length);
            }}
          >
            <For each={words()}>
              {(word, i) => (
                <Show when={word.operator} fallback={<span class="query-word">{word.text}</span>}>
                  <span class="query-chip" classList={{ negated: word.operator!.negated }}>
                    <button
                      type="button"
                      class="query-chip-label"
                      aria-label={`Change ${word.text}`}
                      aria-haspopup="dialog"
                      onClick={(e) => setPicker({ index: i(), pos: below(e.currentTarget) })}
                    >
                      <span class="query-chip-op">{word.operator!.negated ? "-" : ""}{word.operator!.op}:</span>
                      <span class="query-chip-value">{chipValue(word)}</span>
                    </button>
                    <button
                      type="button"
                      class="query-chip-remove"
                      aria-label={`Remove ${word.text}`}
                      onClick={() => props.setQuery(removeWord(props.query, i()))}
                    >
                      ×
                    </button>
                  </span>
                </Show>
              )}
            </For>
          </div>
        </Show>
      </div>
      <Show when={explanation()}>
        <div class="query-explain">{explanation()}</div>
      </Show>

      <Show when={suggestions().length > 0 && menuPos()}>
        <Portal>
          <div
            class="query-autocomplete"
            style={{ top: `${menuPos()!.top}px`, left: `${menuPos()!.left}px`, width: `${menuPos()!.width}px` }}
          >
            <For each={suggestions()}>
              {(suggestion, i) => (
                <div
                  class="query-autocomplete-item"
                  classList={{ selected: i() === menuIndex() }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(suggestion);
                  }}
                >
                  <span class="query-autocomplete-op">{suggestion.text}</span>
                  <span class="query-autocomplete-desc">{suggestion.desc}</span>
                </div>
              )}
            </For>
          </div>
        </Portal>
      </Show>

      <Show when={pickerWord()?.operator && picker()} keyed>
        {(open) => {
          const index = open.index;
          const op = words()[index].operator!;
          const address = ADDRESS_OPERATORS.has(op.op);
          const choices = () => {
            if (address) {
              return matchContacts(props.contacts, pickerFilter(), 8)
                .map(c => ({ value: c.email, label: c.name ? `${c.name} · ${c.email}` : c.email }));
            }
            if (op.op === "label") {
              const typed = pickerFilter().toLowerCase();
              return props.labelNames
                .filter(name => name.toLowerCase().includes(typed))
                .map(name => ({ value: labelQueryValue(name), label: name }));
            }
            return fixedChoices(op.op);
          };
          return (
            <Portal>
              <div
                class="query-picker"
                role="dialog"
                aria-label={op.op}
                style={{ top: `${open.pos.top}px`, left: `${open.pos.left}px` }}
              >
                <Show when={address || op.op === "label"}>
                  <input
                    type="text"
                    class="query-picker-filter"
                    placeholder={address ? "Search contacts" : "Search labels"}
                    value={pickerFilter()}
                    onInput={(e) => setPickerFilter(e.currentTarget.value)}
                    ref={(el) => setTimeout(() => el.focus())}
                  />
                </Show>
                <div class="query-picker-options">
                  <For each={choices()}>
                    {(choice) => (
                      <button
                        type="button"
                        class={`query-picker-option ${choice.value.toLowerCase() === op.value.toLowerCase() ? "current" : ""}`}
                        onClick={() => choose(index, choice.value)}
                      >
                        {choice.label}
                      </button>
                    )}
                  </For>
                </div>
                <div class="query-picker-footer">
                  <button type="button" class="query-picker-option" onClick={() => editAsText(index)}>Edit as text</button>
                </div>
              </div>
            </Portal>
          );
        }}
      </Show>
    </>
  );
};
