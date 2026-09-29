import { Show } from "solid-js";
import { extractEmail, extractName } from "../utils";
import { personName } from "../app/people";

// A From header as the sender's name, with the address beside it when the
// header names someone other than the address itself
export const MessageSender = (props: { from: string }) => {
  const address = () => extractEmail(props.from);
  const named = () => {
    const name = extractName(props.from);
    return !!name && name.toLowerCase() !== address().toLowerCase();
  };
  return (
    <div class="message-sender">
      <span class="message-sender-name">{personName(props.from)}</span>
      <Show when={named()}>
        {" "}<span class="message-sender-address">{address()}</span>
      </Show>
    </div>
  );
};
