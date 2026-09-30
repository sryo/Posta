import { onCleanup, Show, type JSX } from "solid-js";
import { Avatar } from "./Avatar";
import { KeyHint } from "./KeyHint";
import { CloseButton } from "./ComposeAtoms";

// The pieces the compose, event and card forms are built from, so their
// fields, titles and footers look and behave alike.

// The top of a compose or event panel: close first, where every view and
// sheet keeps it, then whose it is and anything else. A panel whose Escape
// discards work passes no onClose and offers Cancel in its footer instead
export function PanelHeader(props: { children: JSX.Element; onClose?: () => void }) {
  return (
    <div class="panel-header">
      <Show when={props.onClose}>
        <CloseButton onClick={props.onClose!} />
      </Show>
      {props.children}
    </div>
  );
}

// The account a panel writes as, with its avatar; `children` replaces the
// plain address, such as with a menu to choose another
export function PanelAccount(props: { email: string; class?: string; children?: JSX.Element }) {
  return (
    <div class={`panel-account ${props.class ?? ""}`}>
      <Avatar email={props.email} size="xs" />
      {props.children ?? <span class="panel-account-email">{props.email}</span>}
    </div>
  );
}

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
        const timer = setTimeout(() => {
          el.focus();
          // A title prefilled from a long subject shows its start, not its tail
          el.setSelectionRange(0, 0);
          el.scrollLeft = 0;
        }, 0);
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
      {props.busy ? props.busyLabel ?? props.label : <>{props.label} <KeyHint keys="⌘↵" /></>}
    </button>
  );
}

export function CancelButton(props: { onClick: () => void }) {
  return (
    <button class="btn btn-ghost" onClick={() => props.onClick()} title="Cancel (Esc)">
      Cancel <KeyHint keys="ESC" />
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
