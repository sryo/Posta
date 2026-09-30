import { onCleanup } from "solid-js";
import { CloseIcon } from "./Icons";
import { isImeComposing } from "../shared/keyboard";

// Shared compose components
export const ComposeTextarea = (props: {
  value: string,
  onChange: (value: string) => void,
  onSend: () => void,
  onCancel: () => void,
  placeholder?: string,
  disabled?: boolean,
  autofocus?: boolean,
  class: string,
}) => {
  return (
    <textarea
      class={props.class}
      placeholder={props.placeholder || "Write your message..."}
      value={props.value}
      onInput={(e) => props.onChange(e.currentTarget.value)}
      disabled={props.disabled}
      ref={(el) => {
        if (!props.autofocus) return;
        const focusTimer = setTimeout(() => el.focus(), 50);
        onCleanup(() => clearTimeout(focusTimer));
      }}
      onKeyDown={(e) => {
        if (isImeComposing(e)) return;
        if (e.key === 'Escape') {
          props.onCancel();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && props.value.trim()) {
          e.preventDefault();
          props.onSend();
        }
      }}
    />
  );
};

export const CloseButton = (props: { onClick: () => void }) => {
  return (
    <button class="close-btn" onClick={props.onClick} title="Close (Esc)">
      <CloseIcon />
      <span class="shortcut-hint">ESC</span>
    </button>
  );
};
