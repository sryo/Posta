import { Show } from "solid-js";
import type { Account } from "../api/tauri";
import { ALL_ACCOUNTS, scopeLabel } from "../app/accountScope";
import { distinctAvatarColors, getInitial } from "../utils";

// Whose mail a card shows, in its header once more than one account is
// signed in: the account's photo, or its initial in a colour no other
// account uses, or All
export function CardAccountBadge(props: { accountId: string; accounts: Account[] }) {
  const all = () => props.accountId === ALL_ACCOUNTS;
  const name = () => scopeLabel({ account_id: props.accountId }, props.accounts);
  const account = () => props.accounts.find(a => a.id === props.accountId);
  const color = () => distinctAvatarColors(props.accounts.map(a => a.email))[props.accounts.findIndex(a => a.id === props.accountId)];
  return (
    <Show when={props.accounts.length > 1 && name()}>
      <span
        class="card-account-badge"
        classList={{ all: all() }}
        style={all() ? undefined : { background: color() }}
        title={name()}
        role="img"
        aria-label={name()}
      >
        <Show when={!all() && account()?.picture} fallback={all() ? "All" : getInitial(name())}>
          {(picture) => <img class="card-account-badge-photo" src={picture()} alt="" />}
        </Show>
      </span>
    </Show>
  );
}
