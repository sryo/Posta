import { Show } from "solid-js";
import { getAvatarHue, getInitial } from "../utils";

// A person or account: their picture, else their initial on a colour of their
// own, taken from their name or address so it stays the same everywhere.
//   xs 22px (a panel's header)  sm 28px (a suggestion list)
//   md 32px (the account list)  lg the toolbar button's size
export function Avatar(props: {
  email: string;
  name?: string;
  picture?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const label = () => props.name || props.email;
  return (
    <span class="avatar" data-size={props.size ?? "sm"} data-hue={props.picture ? undefined : getAvatarHue(label())} aria-hidden="true">
      <Show when={props.picture} fallback={getInitial(label())}>
        {(src) => <img src={src()} alt="" />}
      </Show>
    </span>
  );
}
