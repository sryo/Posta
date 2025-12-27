// Reaction button component with emoji picker

import { createSignal, Show } from "solid-js";
import { EmojiPicker } from "./EmojiPicker";

interface ReactionButtonProps {
  onSelect: (emoji: string) => void;
  disabled?: boolean;
  sending?: boolean;
}

export const ReactionButton = (props: ReactionButtonProps) => {
  const [open, setOpen] = createSignal(false);

  return (
    <div class="reaction-btn-container">
      <button
        class="add-reaction-btn"
        onClick={(e) => {
          e.stopPropagation();
          if (!props.disabled && !props.sending) {
            setOpen(!open());
          }
        }}
        disabled={props.disabled || props.sending}
        title="Add reaction"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <line x1="5" y1="1" x2="5" y2="9"></line>
          <line x1="1" y1="5" x2="9" y2="5"></line>
        </svg>
      </button>
      <Show when={open()}>
        <EmojiPicker
          onSelect={(emoji) => {
            props.onSelect(emoji);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      </Show>
    </div>
  );
};
