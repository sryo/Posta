import { Show, For, createEffect } from "solid-js";
import { IconButton } from "./IconButton";
import { Segmented } from "./Segmented";
import type { Account } from "../api/tauri";
import { ALL_ACCOUNTS } from "../app/accountScope";
import {
  CARD_COLORS,
  EMAIL_GROUP_BY_OPTIONS,
  CALENDAR_GROUP_BY_OPTIONS,
  type CardColor,
  type GroupBy,
} from "../shared/constants";
import { CheckIcon, CloseIcon, QuestionCircleIcon, TrashIcon } from "./Icons";
import { cardTypeForQuery } from "../app/cardType";
import { isImeComposing } from "../shared/keyboard";
import type { RecentContact } from "../app/contacts";
import type { QuerySuggestion } from "../app/querySuggestions";
import { QueryField } from "./QueryField";
import { ColorFlower } from "./ColorFlower";

// A click on ✓ this soon after the form opens is the second half of the
// double-click that opened it, not a save
const SAVE_GUARD_MS = 300;

// A card's header while it is added or edited: the name typed where the title
// shows, and ✓ where the edit button was, so the same spot opens and closes
// the form. The query, grouping and delete sit below it, above the preview.
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
  // Whether anything differs from the saved card; with nothing to save, ✓
  // just closes the form
  dirty?: boolean;
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
  const openedAt = Date.now();
  let queryInput: HTMLInputElement | undefined;

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

  const saves = () => props.mode === 'new' || props.dirty !== false;
  const doneLabel = () => (props.mode === 'new' ? "Add" : saves() ? "Save" : "Done");
  const done = () => {
    if (Date.now() - openedAt < SAVE_GUARD_MS) return;
    if (!saves()) props.onCancel();
    else if (!props.saveDisabled) props.onSave();
  };
  const missing = () => (!props.name.trim() ? "Needs a name" : !props.query.trim() ? "Needs a query" : null);


  return (
    <div class="card-edit">
      <div class="card-edit-header">
        <ColorFlower
          title="Card color"
          colors={CARD_COLORS.map(hue => ({ hue, label: hue[0].toUpperCase() + hue.slice(1) }))}
          value={props.color}
          onChange={(hue) => { props.setColor(hue as CardColor); props.setColorPickerOpen(false); }}
          open={props.colorPickerOpen}
          setOpen={props.setColorPickerOpen}
          toward={45}
          onPreview={(hue) => props.setColor(hue as CardColor)}
          compact
        />
        <input
          type="text"
          class="card-name-input"
          aria-label="Card name"
          value={props.name}
          onInput={(e) => props.setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === 'Escape') props.onCancel();
            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (!props.saveDisabled) props.onSave();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              queryInput?.focus();
            }
          }}
          placeholder="e.g. Clients"
          ref={(el) => setTimeout(() => el.focus(), 50)}
        />
        <div class="card-edit-actions">
          <IconButton label="Cancel" title="Cancel (Esc)" onClick={() => props.onCancel()}>
            <CloseIcon size="tool" />
          </IconButton>
          <button
            type="button"
            class="icon-btn card-edit-done"
            classList={{ "saves": saves() }}
            disabled={saves() && props.saveDisabled}
            onClick={done}
            title={saves() && props.saveDisabled ? missing() ?? doneLabel() : `${doneLabel()} (⌘Enter)`}
            aria-label={doneLabel()}
          >
            <CheckIcon size="tool" />
          </button>
        </div>
      </div>

      <div class="card-edit-body">
        <Show when={(props.accounts?.length ?? 0) > 1}>
          <select
            class="card-account-select"
            aria-label="Account"
            value={props.accountId}
            onChange={(e) => props.setAccountId?.(e.currentTarget.value)}
          >
            <option value={ALL_ACCOUNTS}>All inboxes</option>
            <For each={props.accounts}>
              {(account) => <option value={account.id}>{account.email}</option>}
            </For>
          </select>
        </Show>
        <div ref={(el) => setTimeout(() => { queryInput = el.querySelector("input") ?? undefined; }, 0)}>
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
        <div class="card-edit-controls">
          <Segmented
            label="Group by"
            options={groupByOptions()}
            value={props.groupBy}
            onChange={(value) => props.setGroupBy(value)}
          />
          <IconButton label="Query operators help" size="sm" class="card-edit-help" onClick={() => props.setQueryHelpOpen(true)}>
            <QuestionCircleIcon />
          </IconButton>
          <Show when={props.onDelete}>
            <button
              type="button"
              class="card-delete-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                props.onDelete?.();
              }}
            >
              <TrashIcon /> Delete
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
};
