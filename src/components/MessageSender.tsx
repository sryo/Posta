import { Show } from "solid-js";
import { extractEmail, extractName } from "../utils";
import { personName } from "../app/people";

// A From header as the sender's name, with the address beside it when the
// header names someone
export const MessageSender = (props: { from: string }) => (
  <div class="message-sender">
    <span class="message-sender-name">{personName(props.from)}</span>
    <Show when={extractName(props.from)}>
      {" "}<span class="message-sender-address">{extractEmail(props.from)}</span>
    </Show>
  </div>
);
