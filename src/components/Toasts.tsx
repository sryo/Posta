import { For, Show, type JSX } from "solid-js";
import type { createToasts, ShownToast } from "../app/toasts";
import { CloseIcon } from "./Icons";

type ToastStore = ReturnType<typeof createToasts>;

function Toast(props: { toast: ShownToast; toasts: ToastStore }) {
  const t = () => props.toast;
  return (
    <div
      class={`undo-toast ${t().closing ? "closing" : ""} ${t().paused ? "paused" : ""}`}
      onMouseEnter={() => props.toasts.pause()}
      onMouseLeave={() => props.toasts.resume()}
      onFocusIn={() => props.toasts.pause()}
      onFocusOut={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) props.toasts.resume();
      }}
    >
      <Show when={t().durationMs}>
        {(ms) => <div class="toast-progress" style={{ "animation-duration": `${ms()}ms` }}></div>}
      </Show>
      <div class="toast-content">
        <span class="toast-message">{t().message}</span>
        <Show when={t().undo}>
          <button class="toast-undo-btn" onClick={() => props.toasts.undo()}>Undo <span class="shortcut-hint">z</span></button>
        </Show>
        <Show when={t().action}>
          {(action) => <button class="toast-undo-btn" onClick={() => props.toasts.runAction()}>{action().label}</button>}
        </Show>
        <button class="toast-close-btn" onClick={() => props.toasts.dismiss()} title="Dismiss">
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

// Both live regions stay in the page, empty or not: a region added together
// with its first message is often not announced
export function Toasts(props: { toasts: ToastStore; children?: JSX.Element }) {
  // Keyed by id so each toast mounts afresh and its progress fill restarts
  const shown = (tone: "info" | "error") => {
    const t = props.toasts.current();
    return t && (t.tone ?? "info") === tone ? [t.id] : [];
  };
  const render = () => <Toast toast={props.toasts.current()!} toasts={props.toasts} />;
  return (
    <>
      <div role="status" aria-live="polite">
        <For each={shown("info")}>{render}</For>
        {props.children}
      </div>
      <div aria-live="assertive">
        <For each={shown("error")}>{render}</For>
      </div>
    </>
  );
}
