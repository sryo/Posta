import { createSignal, Show } from "solid-js";
import { useLayer } from "./layers";

// window.confirm can't be used: WKWebView answers it with Cancel unless the
// app implements the UI delegate method, which wry does not
interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
  // Where keyboard focus goes back to once answered
  returnFocus: Element | null;
}

const [request, setRequest] = createSignal<ConfirmRequest | null>(null);

export function confirmOpen(): boolean {
  return request() !== null;
}

// Asks in the app's own dialog; a question still open is answered "no"
export function askConfirm(message: string, confirmLabel = "OK"): Promise<boolean> {
  const previous = request();
  previous?.resolve(false);
  return new Promise(resolve => {
    setRequest({ message, confirmLabel, resolve, returnFocus: previous?.returnFocus ?? document.activeElement });
  });
}

function answer(ok: boolean) {
  const open = request();
  if (!open) return;
  setRequest(null);
  if (open.returnFocus instanceof HTMLElement && open.returnFocus.isConnected) open.returnFocus.focus();
  open.resolve(ok);
}

export function ConfirmDialog() {
  useLayer(confirmOpen, () => answer(false), { closesFromInputs: true });
  return (
    <Show when={request()}>
      {(open) => (
        <div
          class="preset-overlay"
          style={{ "z-index": "var(--z-modal)" }}
          onClick={(e) => { if (e.target === e.currentTarget) answer(false); }}
        >
          <div
            class="preset-modal"
            style={{ "max-width": "420px" }}
            role="alertdialog"
            aria-modal="true"
            aria-label={open().message}
            // Native listener so the app's document-level shortcuts never
            // see keys meant for the dialog
            on:keydown={(e) => e.stopPropagation()}
          >
            <p>{open().message}</p>
            <div class="restore-actions">
              <button class="btn btn-ghost" onClick={() => answer(false)}>Cancel</button>
              <button
                class="btn btn-primary"
                ref={(el) => setTimeout(() => el.focus(), 0)}
                onClick={() => answer(true)}
              >
                {open().confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

// For a view going away with a question still open
export function dismissConfirm() {
  answer(false);
}
