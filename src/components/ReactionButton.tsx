// Reaction button component with emoji picker

import { createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { EMOJI_PICKER_SIZE, EmojiPicker } from "./EmojiPicker";
import { placeBelowAnchor } from "../app/popoverPlacement";
import { PlusIcon } from "./Icons";

interface ReactionButtonProps {
  onSelect: (emoji: string) => void;
  sending?: boolean;
}

export const ReactionButton = (props: ReactionButtonProps) => {
  const [at, setAt] = createSignal<{ top: number; left: number } | null>(null);
  let buttonRef: HTMLButtonElement | undefined;
  let pickerHost: HTMLDivElement | undefined;

  // The picker is fixed to the viewport, so it would drift off its button
  // when the thread scrolls underneath
  const closeOnOutsideScroll = (e: Event) => {
    if (e.target instanceof Node && pickerHost?.contains(e.target)) return;
    setAt(null);
  };
  document.addEventListener("scroll", closeOnOutsideScroll, true);
  onCleanup(() => document.removeEventListener("scroll", closeOnOutsideScroll, true));

  const open = () => !!at();
  const openPicker = () => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    setAt(placeBelowAnchor(buttonRef!.getBoundingClientRect(), EMOJI_PICKER_SIZE, viewport));
  };

  return (
    <div class="reaction-btn-container">
      <button
        ref={buttonRef}
        class="add-reaction-btn"
        // Native listener: keeps the picker's outside-mousedown handler from
        // closing it just before this click would toggle it open again
        on:mousedown={(e) => { if (open()) e.stopPropagation(); }}
        onClick={(e) => {
          e.stopPropagation();
          if (props.sending) return;
          if (open()) setAt(null);
          else openPicker();
        }}
        disabled={props.sending}
        title="Add reaction"
      >
        <PlusIcon size="meta" />
      </button>
      {/* Out of the message card: a sticky card is its own stacking context
          and, beside an inline reply, narrow and scrolling */}
      <Show when={at()}>
        {(position) => (
          <Portal ref={pickerHost}>
            <EmojiPicker
              at={position()}
              onSelect={(emoji) => {
                props.onSelect(emoji);
                setAt(null);
              }}
              onClose={() => setAt(null)}
            />
          </Portal>
        )}
      </Show>
    </div>
  );
};
