import { Show } from "solid-js";
import type { Account } from "../api/tauri";
import { ALL_ACCOUNTS, scopeLabel } from "../app/accountScope";
import { getAvatarColor, getInitial } from "../utils";

// Whose mail a card shows, in its header once more than one account is
// signed in: the account's initial in its color, or All
export function CardAccountBadge(props: { accountId: string; accounts: Account[] }) {
  const all = () => props.accountId === ALL_ACCOUNTS;
  const name = () => scopeLabel({ account_id: props.accountId }, props.accounts);
  return (
    <Show when={props.accounts.length > 1 && name()}>
      <span
        class="card-account-badge"
        classList={{ all: all() }}
        style={all() ? undefined : { background: getAvatarColor(name()) }}
        title={name()}
        role="img"
        aria-label={name()}
      >
        {all() ? "All" : getInitial(name())}
      </span>
    </Show>
  );
}
