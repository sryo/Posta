import { Show, For, createEffect, createUniqueId } from "solid-js";
import type { Account } from "../api/tauri";
import { ALL_ACCOUNTS } from "../app/accountScope";
import {
  CARD_COLORS,
  COLOR_HEX,
  EMAIL_GROUP_BY_OPTIONS,
  CALENDAR_GROUP_BY_OPTIONS,
  type CardColor,
  type GroupBy,
} from "../shared/constants";
import { PaletteIcon, TrashIcon } from "./Icons";
import { cardTypeForQuery } from "../app/cardType";
import { isImeComposing, onActivateKey } from "../shared/keyboard";
import type { RecentContact } from "../app/contacts";
import type { QuerySuggestion } from "../app/querySuggestions";
import { QueryField } from "./QueryField";
import { CancelButton, FormFooter, SubmitButton } from "./FormParts";

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
  setQueryHelpOpen: (v: boolean) => void;
  suggestQuery: (query: string, caret: number) => QuerySuggestion[];
  contacts: RecentContact[];
  labelNames: string[];
  debounceQueryPreview: (query: string) => void;
  // Receives the function that inserts text at the query field's caret
  onQueryFieldActive: (insert: (text: string) => void) => void;
  // Whose mail the card shows: one account, or ALL_ACCOUNTS. Asked only
  // with more than one account signed in.
  accounts?: Account[];
  accountId?: string;
  setAccountId?: (id: string) => void;
}) => {
  const accountFieldId = createUniqueId();
  const setQuery = (query: string) => {
    props.setQuery(query);
    props.debounceQueryPreview(query);
  };

  const groupByOptions = () =>
    cardTypeForQuery(props.query) === "calendar" ? CALENDAR_GROUP_BY_OPTIONS : EMAIL_GROUP_BY_OPTIONS;

  // Switching between email and calendar queries can leave a grouping the
  // new card type doesn't offer, such as "sender" on a calendar card
  createEffect(() => {
    if (!groupByOptions().some(o => o.value === props.groupBy)) props.setGroupBy("date");
  });

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
              if (isImeComposing(e)) return;
              if (e.key === 'Escape') props.onCancel();
              else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !props.saveDisabled) {
                e.preventDefault();
                props.onSave();
              }
            }}
            placeholder="e.g. Clients"
            ref={(el) => setTimeout(() => el.focus(), 50)}
          />
          <div class={`color-picker ${props.colorPickerOpen ? 'open' : ''}`}>
            <div
              class={`color-picker-selected ${props.color === null ? 'no-color' : ''}`}
              style={props.color ? { background: COLOR_HEX[props.color] } : {}}
              onClick={(e) => { e.stopPropagation(); props.setColorPickerOpen(!props.colorPickerOpen); }}
              role="button"
              tabIndex={0}
              aria-expanded={props.colorPickerOpen}
              on:keydown={onActivateKey(() => props.setColorPickerOpen(!props.colorPickerOpen))}
              title="Card color"
            >
              <Show when={props.color === null}>
                <PaletteIcon />
              </Show>
            </div>
            <For each={[null, ...CARD_COLORS] as CardColor[]}>
              {(color) => {
                const pick = () => { props.setColor(color); props.setColorPickerOpen(false); };
                return (
                  <div
                    class={color ? `color-option ${color}` : "color-option no-color-option"}
                    role="button"
                    tabIndex={props.colorPickerOpen ? 0 : -1}
                    aria-label={color ?? "No color"}
                    onClick={pick}
                    on:keydown={onActivateKey(pick)}
                  ></div>
                );
              }}
            </For>
          </div>
        </div>
      </div>
      <Show when={(props.accounts?.length ?? 0) > 1}>
        <div class="card-form-group">
          <label for={accountFieldId}>Account</label>
          <select
            id={accountFieldId}
            value={props.accountId}
            onChange={(e) => props.setAccountId?.(e.currentTarget.value)}
          >
            <option value={ALL_ACCOUNTS}>All inboxes</option>
            <For each={props.accounts}>
              {(account) => <option value={account.id}>{account.email}</option>}
            </For>
          </select>
        </div>
      </Show>
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
        <QueryField
          query={props.query}
          setQuery={setQuery}
          suggest={props.suggestQuery}
          contacts={props.contacts}
          labelNames={props.labelNames}
          onSave={() => { if (!props.saveDisabled) props.onSave(); }}
          onCancel={props.onCancel}
          onActive={props.onQueryFieldActive}
        />
      </div>
      <div class="card-form-group">
        <label>Group</label>
        <div class="group-by-buttons">
          <For each={groupByOptions()}>
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
      <FormFooter
        class="card-form-actions"
        leading={
          <Show when={props.onDelete}>
            <button class="btn btn-danger" onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onDelete?.();
            }}>
              <TrashIcon /> Delete
            </button>
          </Show>
        }
      >
        <CancelButton onClick={props.onCancel} />
        <SubmitButton label={props.mode === 'new' ? 'Add' : 'Save'} disabled={props.saveDisabled} onClick={props.onSave} />
      </FormFooter>
    </div>
  );
};
