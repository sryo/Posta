import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { CALENDAR_RANGES, GMAIL_OPERATORS } from "../shared/constants";
import { matchContacts, type RecentContact } from "../app/contacts";
import { labelQueryValue, type QuerySuggestion } from "../app/querySuggestions";
import { describeQuery, operatorText, queryWords, removeWord, replaceWord, type QueryWord } from "../app/queryTokens";
import {
  commitTyped,
  composeQuery,
  draftAtEnd,
  draftAtWord,
  editPrevious,
  stepLeft,
  stepRight,
  suggestionContext,
  type QueryDraft,
} from "../app/queryDraft";
import { isImeComposing } from "../shared/keyboard";
import { CloseIcon } from "./Icons";

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

// Which words a chip belongs to: the whole query at rest, or the finished
// words before or after the text box while typing
type Section = "all" | "head" | "tail";

// A card query field. Recognised operators show as chips that open a picker
// and plain words stay text. While focused, the words already finished stay
// chips around a text box, with autocomplete for the word at its caret.
export const QueryField = (props: {
  query: string;
  setQuery: (query: string) => void;
  suggest: (query: string, caret: number) => QuerySuggestion[];
  contacts: RecentContact[];
  labelNames: string[];
  onSave: () => void;
  onCancel: () => void;
  // Enter with nothing being typed, or with no suggestion to take
  onSubmit?: () => void;
  placeholder?: string;
  inputRef?: (el: HTMLInputElement) => void;
  // Receives the function that inserts text at this field's caret, whenever
  // the field appears or gains focus
  onActive?: (insert: (text: string) => void) => void;
}) => {
  let input!: HTMLInputElement;
  let chips: HTMLDivElement | undefined;
  const [editing, setEditing] = createSignal(false);
  const [parts, setParts] = createSignal<QueryDraft>(draftAtEnd(props.query));
  const [caret, setCaret] = createSignal(0);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [menuIndex, setMenuIndex] = createSignal(0);
  const [menuPos, setMenuPos] = createSignal<Rect | null>(null);
  const [picker, setPicker] = createSignal<{ section: Section; index: number; pos: Rect } | null>(null);
  const [pickerFilter, setPickerFilter] = createSignal("");

  // Where the text box sits, as long as it still spells the query; a query
  // changed from outside puts it back at the end
  const view = createMemo(() => (composeQuery(parts()) === props.query.trim() ? parts() : draftAtEnd(props.query)));
  const sectionText = (section: Section) => (section === "all" ? props.query : view()[section]);
  const sectionWords = (section: Section) => queryWords(sectionText(section));
  const headWords = createMemo(() => sectionWords(editing() ? "head" : "all"));
  const tailWords = createMemo(() => (editing() ? sectionWords("tail") : []));
  const explanation = createMemo(() => describeQuery(props.query));
  const context = createMemo(() => suggestionContext(view(), caret()));
  const suggestions = createMemo(() => (editing() && menuOpen() ? props.suggest(context().query, context().caret) : []));

  const contactName = (email: string) => props.contacts.find(c => c.email.toLowerCase() === email.toLowerCase())?.name;
  const chipValue = (word: QueryWord) => {
    const op = word.operator!;
    return (ADDRESS_OPERATORS.has(op.op) && contactName(op.value)) || op.value;
  };

  function readCaret() {
    setCaret(input.selectionStart ?? input.value.length);
  }

  function placeCaret(at: number) {
    setCaret(at);
    input.setSelectionRange(at, at);
  }

  function openMenu() {
    readCaret();
    setMenuIndex(0);
    setMenuOpen(true);
    setMenuPos(below(chips ?? input));
  }

  // Shows `next` and makes the query what it spells
  function update(next: QueryDraft, at: number) {
    setParts(next);
    props.setQuery(composeQuery(next));
    if (editing() && input.value !== next.draft) input.value = next.draft;
    placeCaret(at);
  }

  function focusInput() {
    input.focus();
    input.setSelectionRange(caret(), caret());
  }

  function applySuggestion(suggestion: QuerySuggestion) {
    const d = view();
    const { offset } = context();
    const start = Math.max(0, suggestion.replace.start - offset);
    const end = Math.max(start, suggestion.replace.end - offset);
    const text = suggestion.text + (suggestion.text.endsWith(":") ? "" : " ");
    const draft = d.draft.slice(0, start) + text + d.draft.slice(end).replace(/^\s+/, "");
    const next = commitTyped({ ...d, draft }, start + text.length);
    input.focus();
    update(next.draft, next.caret);
    setMenuOpen(false);
  }

  function insert(text: string) {
    focusInput();
    const d = view();
    const at = Math.min(caret(), d.draft.length);
    const before = d.draft.slice(0, at);
    const after = d.draft.slice(at);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const trail = after && !/^\s/.test(after) ? " " : "";
    update({ ...d, draft: before + lead + text + trail + after }, before.length + lead.length + text.length);
  }

  onMount(() => props.onActive?.(insert));

  // The index in the whole query of a word shown in a section
  function queryIndex(section: Section, index: number): number {
    if (section !== "tail") return index;
    const d = view();
    return queryWords(d.head).length + queryWords(d.draft.trim()).length + index;
  }

  function editWordAsText(section: Section, index: number) {
    const next = draftAtWord(props.query, queryIndex(section, index));
    setParts(next.draft);
    setCaret(next.caret);
    focusInput();
  }

  function changeWord(section: Section, index: number, text: string | null) {
    const source = sectionText(section);
    const changed = text === null ? removeWord(source, index) : replaceWord(source, index, text);
    if (section === "all") {
      props.setQuery(changed);
      return;
    }
    setParts({ ...view(), [section]: changed });
    props.setQuery(composeQuery(parts()));
  }

  // Closing from inside the picker hands focus back to where it came from:
  // the chip at rest, the text box while typing
  function closePicker(refocus = false) {
    const open = picker();
    setPicker(null);
    setPickerFilter("");
    if (!open) return;
    if (open.section === "all") {
      if (refocus) chips?.querySelector<HTMLElement>(`.query-chip-label[data-index="${open.index}"]`)?.focus();
    } else if (refocus) {
      focusInput();
    } else if (!chips?.contains(document.activeElement)) {
      setEditing(false);
    }
  }

  function choose(value: string) {
    const open = picker()!;
    const op = sectionWords(open.section)[open.index].operator!;
    changeWord(open.section, open.index, operatorText(op.op, value, op.negated));
    closePicker(true);
  }

  function editAsText() {
    const open = picker()!;
    closePicker();
    editWordAsText(open.section, open.index);
  }

  createEffect(() => {
    if (!menuOpen() && !picker()) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".query-picker")) closePicker();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !picker()) return;
      e.stopPropagation();
      closePicker(true);
    };
    const reposition = () => {
      if (menuOpen()) setMenuPos(below(chips ?? input));
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
    return p ? sectionWords(p.section)[p.index] : undefined;
  };

  // Keys that move the text box between chips or take a chip back into it
  function navigate(e: KeyboardEvent): boolean {
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    const d = { ...view(), draft: input.value };
    if (e.key === "Backspace" && atStart) {
      const next = editPrevious(d);
      if (!next) return false;
      update(next.draft, next.caret);
      return true;
    }
    const next = e.key === "ArrowLeft" && atStart ? stepLeft(d) : e.key === "ArrowRight" && atEnd ? stepRight(d) : null;
    if (!next) return false;
    update(next, 0);
    return true;
  }

  const renderWord = (section: Section) => (word: QueryWord, i: () => number) => (
    <Show
      when={word.operator}
      fallback={
        <span
          class="query-word"
          onMouseDown={(e) => {
            e.preventDefault();
            editWordAsText(section, i());
          }}
        >
          {word.text}
        </span>
      }
    >
      <span class="query-chip" classList={{ negated: word.operator!.negated }}>
        <button
          type="button"
          class="query-chip-label"
          data-index={section === "all" ? i() : undefined}
          aria-label={`Change ${word.text}`}
          aria-haspopup="dialog"
          onMouseDown={(e) => { if (editing()) e.preventDefault(); }}
          onClick={(e) => setPicker({ section, index: i(), pos: below(e.currentTarget) })}
        >
          <span class="query-chip-op">{word.operator!.negated ? "-" : ""}{word.operator!.op}:</span>
          <span class="query-chip-value">{chipValue(word)}</span>
        </button>
        <button
          type="button"
          class="query-chip-remove"
          aria-label={`Remove ${word.text}`}
          onMouseDown={(e) => { if (editing()) e.preventDefault(); }}
          onClick={() => changeWord(section, i(), null)}
        ><CloseIcon size="meta" /></button>
      </span>
    </Show>
  );

  return (
    <>
      <div
        class="query-field"
        classList={{ editing: editing() || headWords().length === 0 }}
        onFocusOut={(e) => {
          // Tabbing onto a chip keeps the chips where they are, so the focus stays on it
          if (chips?.contains(e.relatedTarget as Node | null)) return;
          if (!picker()) setEditing(false);
        }}
      >
        <div
          ref={chips}
          class="query-chips"
          onMouseDown={(e) => {
            if (e.target !== e.currentTarget) return;
            e.preventDefault();
            if (!editing()) {
              setParts(draftAtEnd(props.query));
              setCaret(0);
            }
            focusInput();
          }}
        >
          <For each={headWords()}>{(word, i) => renderWord(editing() ? "head" : "all")(word, i)}</For>
          <input
            type="text"
            ref={(el) => { input = el; props.inputRef?.(el); }}
            value={editing() ? view().draft : props.query}
            aria-label="Query"
            size={Math.max(4, (editing() ? view().draft.length : 0) + 1)}
            placeholder={props.placeholder ?? "e.g. from:boss is:unread newer_than:7d"}
            onInput={(e) => {
              if (!editing()) {
                props.setQuery(e.currentTarget.value);
                return;
              }
              const value = e.currentTarget.value;
              const at = e.currentTarget.selectionStart ?? value.length;
              const typed = { ...view(), draft: value };
              const next = e.isComposing ? { draft: typed, caret: at } : commitTyped(typed, at);
              update(next.draft, next.caret);
              openMenu();
            }}
            onFocus={() => {
              if (!editing()) {
                if (view() !== parts()) setParts(view());
                if (caret() > view().draft.length) setCaret(view().draft.length);
                setEditing(true);
                input.setSelectionRange(caret(), caret());
              }
              props.onActive?.(insert);
              openMenu();
            }}
            onBlur={() => { setMenuOpen(false); }}
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
              if (editing() && navigate(e)) {
                e.preventDefault();
                return;
              }
              if (e.key === "Enter" && props.onSubmit && (list.length === 0 || !view().draft.trim())) {
                e.preventDefault();
                setMenuOpen(false);
                props.onSubmit();
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
          <For each={tailWords()}>{(word, i) => renderWord("tail")(word, i)}</For>
        </div>
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
          const op = sectionWords(open.section)[open.index].operator!;
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
          let options!: HTMLDivElement;
          onMount(() => {
            if (address || op.op === "label") return;
            (options.querySelector<HTMLElement>(".query-picker-option.current") ?? options.querySelector<HTMLElement>("button"))?.focus();
          });
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
                <div class="query-picker-options" ref={options}>
                  <For each={choices()}>
                    {(choice) => (
                      <button
                        type="button"
                        class={`query-picker-option ${choice.value.toLowerCase() === op.value.toLowerCase() ? "current" : ""}`}
                        onClick={() => choose(choice.value)}
                      >
                        {choice.label}
                      </button>
                    )}
                  </For>
                </div>
                <div class="query-picker-footer">
                  <button type="button" class="query-picker-option" onClick={() => editAsText()}>Edit as text</button>
                </div>
              </div>
            </Portal>
          );
        }}
      </Show>
    </>
  );
};
