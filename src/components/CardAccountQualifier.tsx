import { Show } from "solid-js";
import type { Account } from "../api/tauri";
import { ALL_ACCOUNTS, shortAccountLabel } from "../app/accountScope";

interface QualifierProps {
  accountId: string;
  accounts: Account[];
  // Whether the board mixes accounts, so cards need to say whose mail they show
  shown: boolean;
  // A sync problem's word, shown in red in the qualifier's place
  problem: string | null;
}

function fullName(accountId: string, accounts: Account[]): string {
  if (accountId === ALL_ACCOUNTS) return "all accounts";
  return accounts.find(a => a.id === accountId)?.email ?? "";
}

// Muted text after a card's title saying whose mail it shows: the shortest
// label that tells the accounts apart, and the full address while the card is
// hovered or focused. The title button's label names the account instead.
export function CardAccountQualifier(props: QualifierProps) {
  const short = () => (props.accountId === ALL_ACCOUNTS ? "" : shortAccountLabel(props.accounts).get(props.accountId) ?? "");
  return (
    <Show
      when={!props.problem}
      fallback={<span class="card-account-qualifier problem" aria-hidden="true">{props.problem}</span>}
    >
      <Show when={props.shown && fullName(props.accountId, props.accounts)}>
        {(full) => (
          <span class="card-account-qualifier" aria-hidden="true">
            <span class="card-account-qualifier-short">{short()}</span>
            <span class="card-account-qualifier-full">{full()}</span>
          </span>
        )}
      </Show>
    </Show>
  );
}

// The accessible name of a card's title, which is its collapse button
export function cardTitleLabel(state: QualifierProps & { name: string; collapsed: boolean; unread: number }): string {
  const parts = [state.name];
  const account = state.shown ? fullName(state.accountId, state.accounts) : "";
  if (account) parts.push(account);
  if (state.problem) parts.push(state.problem.toLowerCase());
  if (state.collapsed && state.unread > 0) parts.push(`${state.unread} unread`);
  return `${parts.join(", ")}. ${state.collapsed ? "Expand" : "Collapse"}`;
}
