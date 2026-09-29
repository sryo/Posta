import { createSignal, Show } from "solid-js";
import { useDialog } from "./dialog";

export interface ConfirmOptions {
  // Bold first line; the message explains it
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // A destructive answer: a red button, and focus starts on the safe one
  tone?: "danger";
}

// window.confirm can't be used: WKWebView answers it with Cancel unless the
// app implements the UI delegate method, which wry does not
interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
  // Where keyboard focus goes back to once answered
  returnFocus: Element | null;
}

const [request, setRequest] = createSignal<ConfirmRequest | null>(null);

export function confirmOpen(): boolean {
  return request() !== null;
}

// Asks in the app's own dialog; a question still open is answered "no"
export function askConfirm(question: string | ConfirmOptions, confirmLabel = "OK"): Promise<boolean> {
  const options = typeof question === "string" ? { message: question, confirmLabel } : question;
  const previous = request();
  previous?.resolve(false);
  return new Promise(resolve => {
    setRequest({ ...options, resolve, returnFocus: previous?.returnFocus ?? document.activeElement });
  });
}

function answer(ok: boolean) {
  const open = request();
  if (!open) return;
  setRequest(null);
  if (open.returnFocus instanceof HTMLElement && open.returnFocus.isConnected) open.returnFocus.focus();
  open.resolve(ok);
}

function ConfirmBox(props: { request: ConfirmRequest }) {
  const danger = () => props.request.tone === "danger";
  const ref = useDialog({
    role: "alertdialog",
    onClose: () => answer(false),
    closesFromInputs: true,
    initialFocus: (el) => el.querySelector<HTMLElement>(danger() ? ".btn-ghost" : ".btn-primary"),
  });
  return (
    <div
      class="preset-modal confirm-dialog"
      style={{ "max-width": "420px" }}
      ref={ref}
      aria-label={props.request.title ?? props.request.message}
      // Native listener so the app's document-level shortcuts never
      // see keys meant for the dialog
      on:keydown={(e) => e.stopPropagation()}
    >
      <Show when={props.request.title}>
        <p><strong>{props.request.title}</strong></p>
      </Show>
      <p>{props.request.message}</p>
      <div class="restore-actions">
        <button class="btn btn-ghost" onClick={() => answer(false)}>
          {props.request.cancelLabel ?? "Cancel"}
        </button>
        <button class={`btn ${danger() ? "btn-danger" : "btn-primary"}`} onClick={() => answer(true)}>
          {props.request.confirmLabel ?? "OK"}
        </button>
      </div>
    </div>
  );
}

export function ConfirmDialog() {
  return (
    <Show when={request()}>
      {(open) => (
        <div
          class="preset-overlay"
          style={{ "z-index": "var(--z-modal)" }}
          onClick={(e) => { if (e.target === e.currentTarget) answer(false); }}
        >
          <ConfirmBox request={open()} />
        </div>
      )}
    </Show>
  );
}

// For a view going away with a question still open
export function dismissConfirm() {
  answer(false);
}
