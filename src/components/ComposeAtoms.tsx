import { CloseIcon } from "./Icons";

// Shared compose components
export const ComposeTextarea = (props: {
  value: string,
  onChange: (value: string) => void,
  onSend: () => void,
  onCancel: () => void,
  placeholder?: string,
  disabled?: boolean,
  autofocus?: boolean,
  class?: string,
}) => {
  return (
    <textarea
      class={props.class || "compose-textarea"}
      placeholder={props.placeholder || "Write your message..."}
      value={props.value}
      onInput={(e) => props.onChange(e.currentTarget.value)}
      disabled={props.disabled}
      ref={(el) => props.autofocus && setTimeout(() => el?.focus(), 50)}
      onKeyDown={(e) => {
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

export const ComposeSendButton = (props: {
  onClick: () => void,
  disabled?: boolean,
  sending?: boolean,
}) => {
  return (
    <button
      class={`btn btn-primary ${props.sending ? 'sending' : ''}`}
      disabled={props.disabled || props.sending}
      onClick={props.onClick}
    >
      {props.sending ? 'Sending...' : <>Send<span class="shortcut-hint">⌘↵</span></>}
    </button>
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
