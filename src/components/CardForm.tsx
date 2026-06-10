import { Show, For, type Setter } from "solid-js";
import {
  CARD_COLORS,
  COLOR_HEX,
  EMAIL_GROUP_BY_OPTIONS,
  CALENDAR_GROUP_BY_OPTIONS,
  type CardColor,
  type GroupBy,
} from "../shared/constants";
import { PaletteIcon, TrashIcon } from "./Icons";

interface QuerySuggestion {
  text: string;
  desc: string;
  replace: { start: number; end: number };
}

// Shared card form component for new and edit modes
export const CardForm = (props: {
  mode: 'new' | 'edit';
  name: string;
  setName: (v: string) => void;
  query: string;
  setQuery: (v: string) => void;
  color: CardColor;
  setColor: (v: CardColor) => void;
  groupBy: GroupBy;
  setGroupBy: (v: GroupBy) => void;
  colorPickerOpen: boolean;
  setColorPickerOpen: (v: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  saveDisabled: boolean;
  // Query autocomplete wiring (state lives in App)
  setQueryHelpOpen: (v: boolean) => void;
  setQueryInputRef: (el: HTMLInputElement) => void;
  getQuerySuggestions: (query: string) => QuerySuggestion[];
  queryAutocompleteOpen: () => boolean;
  setQueryAutocompleteOpen: (v: boolean) => void;
  queryAutocompleteIndex: () => number;
  setQueryAutocompleteIndex: (v: number) => void;
  updateDropdownPosition: () => void;
  debounceQueryPreview: (query: string) => void;
  setActiveQueryGetter: Setter<(() => string) | null>;
  setActiveQuerySetter: Setter<((q: string) => void) | null>;
  applyQuerySuggestion: (suggestion: QuerySuggestion) => void;
}) => {
  return (
    <div class="card-form">
      <div class="card-form-group">
        <label>Name</label>
        <div class="name-color-row">
          <input
            type="text"
            value={props.name}
            onInput={(e) => props.setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') props.onCancel();
              else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !props.saveDisabled) {
                e.preventDefault();
                props.onSave();
              }
            }}
            placeholder="Inbox, Starred..."
            autofocus={props.mode === 'edit'}
            ref={props.mode === 'new' ? (el) => setTimeout(() => el?.focus(), 50) : undefined}
          />
          <div class={`color-picker ${props.colorPickerOpen ? 'open' : ''}`}>
            <div
              class={`color-picker-selected ${props.color === null ? 'no-color' : ''}`}
              style={props.color ? { background: COLOR_HEX[props.color] } : {}}
              onClick={(e) => { e.stopPropagation(); props.setColorPickerOpen(!props.colorPickerOpen); }}
              title="Card color"
            >
              <Show when={props.color === null}>
                <PaletteIcon />
              </Show>
            </div>
            <div
              class="color-option no-color-option"
              onClick={() => { props.setColor(null); props.setColorPickerOpen(false); }}
            ></div>
            <For each={CARD_COLORS}>
              {(color) => (
                <div
                  class={`color-option ${color}`}
                  onClick={() => { props.setColor(color); props.setColorPickerOpen(false); }}
                ></div>
              )}
            </For>
          </div>
        </div>
      </div>
      <div class="card-form-group">
        <label class="query-label">
          Query
          <button
            type="button"
            class="query-help-btn"
            onClick={() => props.setQueryHelpOpen(true)}
            title="Query operators help"
          >
            ?
          </button>
        </label>
        <input
          type="text"
          ref={(el) => props.setQueryInputRef(el)}
          value={props.query}
          onInput={(e) => {
            const value = e.currentTarget.value;
            props.setQuery(value);
            const suggestions = props.getQuerySuggestions(value);
            props.setQueryAutocompleteOpen(suggestions.length > 0);
            props.setQueryAutocompleteIndex(0);
            props.updateDropdownPosition();
            props.debounceQueryPreview(value);
          }}
          onFocus={() => {
            props.setActiveQueryGetter(() => () => props.query);
            props.setActiveQuerySetter(() => props.setQuery);
            const suggestions = props.getQuerySuggestions(props.query);
            props.setQueryAutocompleteOpen(suggestions.length > 0);
            props.updateDropdownPosition();
          }}
          onBlur={() => setTimeout(() => props.setQueryAutocompleteOpen(false), 150)}
          onKeyDown={(e) => {
            const suggestions = props.getQuerySuggestions(props.query);
            if (e.key === 'Escape') {
              if (props.queryAutocompleteOpen()) {
                props.setQueryAutocompleteOpen(false);
              } else {
                props.onCancel();
              }
              return;
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !props.saveDisabled) {
              e.preventDefault();
              props.onSave();
              return;
            }
            if (!props.queryAutocompleteOpen() || suggestions.length === 0) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              props.setQueryAutocompleteIndex((props.queryAutocompleteIndex() + 1) % suggestions.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              props.setQueryAutocompleteIndex((props.queryAutocompleteIndex() - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              if (suggestions[props.queryAutocompleteIndex()]) {
                e.preventDefault();
                props.applyQuerySuggestion(suggestions[props.queryAutocompleteIndex()]);
              }
            }
          }}
          placeholder="is:inbox, from:boss, newer_than:7d"
        />
      </div>
      <div class="card-form-group">
        <label>Group</label>
        <div class="group-by-buttons">
          <For each={props.query.toLowerCase().includes("calendar:") ? CALENDAR_GROUP_BY_OPTIONS : EMAIL_GROUP_BY_OPTIONS}>
            {(option) => (
              <button
                class={`group-by-btn ${props.groupBy === option.value ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  props.setGroupBy(option.value);
                }}
                type="button"
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="card-form-actions">
        <Show when={props.onDelete}>
          <button class="btn btn-danger" onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onDelete?.();
          }}>
            <TrashIcon /> Delete
          </button>
          <div style="flex: 1"></div>
        </Show>
        <button class="btn" onClick={props.onCancel} title="Cancel (Esc)">
          Cancel <span class="shortcut-hint">ESC</span>
        </button>
        <button
          class="btn btn-primary"
          onClick={props.onSave}
          disabled={props.saveDisabled}
          title={`${props.mode === 'new' ? 'Add' : 'Save'} (⌘Enter)`}
        >
          {props.mode === 'new' ? 'Add' : 'Save'} <span class="shortcut-hint">⌘↵</span>
        </button>
      </div>
    </div>
  );
};
