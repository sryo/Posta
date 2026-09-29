import { onCleanup, Show, type JSX } from "solid-js";

// The pieces the compose, event and card forms are built from, so their
// fields, titles and footers look and behave alike.

// A row of a form: its label on the left, the control filling the rest
export function FieldRow(props: { label?: string; for?: string; class?: string; children: JSX.Element }) {
  return (
    <div class={`compose-field form-field-row ${props.class ?? ""}`}>
      <Show when={props.label}>
        <label for={props.for}>{props.label}</label>
      </Show>
      {props.children}
    </div>
  );
}

// The large borderless input a form opens with, such as an event's title
export function TitleField(props: {
  value: string;
  placeholder: string;
  onInput: (value: string) => void;
  label?: string;
  autofocus?: boolean;
}) {
  return (
    <input
      type="text"
      class="form-title-field"
      value={props.value}
      onInput={(e) => props.onInput(e.currentTarget.value)}
      placeholder={props.placeholder}
      aria-label={props.label ?? props.placeholder}
      ref={(el) => {
        if (!props.autofocus) return;
        const timer = setTimeout(() => el.focus(), 0);
        onCleanup(() => clearTimeout(timer));
      }}
    />
  );
}

// A form's main button, showing ⌘↵, which saves or sends it
export function SubmitButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  title?: string;
}) {
  return (
    <button
      class="btn btn-primary"
      disabled={props.disabled || props.busy}
      onClick={() => props.onClick()}
      title={props.title ?? `${props.label} (⌘Enter)`}
    >
      {props.busy ? props.busyLabel ?? props.label : <>{props.label} <span class="shortcut-hint">⌘↵</span></>}
    </button>
  );
}

export function CancelButton(props: { onClick: () => void }) {
  return (
    <button class="btn" onClick={() => props.onClick()} title="Cancel (Esc)">
      Cancel <span class="shortcut-hint">ESC</span>
    </button>
  );
}

// The bar under a form: `leading` controls on the left (attach, delete),
// then the error or else the status, then the buttons on the right
export function FormFooter(props: {
  class?: string;
  leading?: JSX.Element;
  error?: string | null;
  status?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class={`form-footer ${props.class ?? ""}`}>
      {props.leading}
      <div class="form-footer-status">
        <Show when={props.error} fallback={props.status}>
          <div class="compose-error" role="alert">{props.error}</div>
        </Show>
      </div>
      <div class="form-footer-actions">{props.children}</div>
    </div>
  );
}
