import { Show } from "solid-js";
import { IconButton } from "./IconButton";
import { CloseIcon } from "./Icons";

// One line of meta type stating something Posta noticed or just did, with
// the obvious action when there is one and a × to put it away
export const NoticeLine = (props: {
  text: string;
  action?: { label: string; run: () => void };
  onDismiss?: () => void;
  class?: string;
}) => (
  <div class={`notice-line${props.class ? ` ${props.class}` : ""}`}>
    <p class="notice-line-text" role="status">{props.text}</p>
    <Show when={props.action}>
      {(action) => <button type="button" class="link-btn notice-line-action" onClick={() => action().run()}>{action().label}</button>}
    </Show>
    <Show when={props.onDismiss}>
      <IconButton label="Dismiss" size="sm" class="notice-line-dismiss" onClick={() => props.onDismiss!()}>
        <CloseIcon size="meta" />
      </IconButton>
    </Show>
  </div>
);
