import { For, Show, type JSX } from "solid-js";
import { KeyHint } from "./KeyHint";
import { toastActions, type createToasts, type ShownToast } from "../app/toasts";
import { CloseIcon } from "./Icons";

type ToastStore = ReturnType<typeof createToasts>;

function Toast(props: { toast: ShownToast; toasts: ToastStore; raised?: boolean }) {
  const t = () => props.toast;
  const id = () => props.toast.id;
  return (
    <div
      class={`undo-toast ${t().closing ? "closing" : ""} ${t().paused ? "paused" : ""} ${props.raised ? "raised" : ""}`}
      onMouseEnter={() => props.toasts.pause(id())}
      onMouseLeave={(e) => {
        if (!e.currentTarget.contains(document.activeElement)) props.toasts.resume(id());
      }}
      onFocusIn={() => props.toasts.pause(id())}
      onFocusOut={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) props.toasts.resume(id());
      }}
    >
      <Show when={t().durationMs}>
        {(ms) => <div class="toast-progress" style={{ "animation-duration": `${ms()}ms` }}></div>}
      </Show>
      <div class="toast-content">
        <span class="toast-message">{t().message}</span>
        <Show when={t().undo}>
          <button class="toast-undo-btn" onClick={() => props.toasts.undo()}>Undo <KeyHint keys="z" /></button>
        </Show>
        <For each={toastActions(t())}>
          {(action, i) => <button class="toast-undo-btn" onClick={() => props.toasts.runAction(i(), id())}>{action.label}</button>}
        </For>
        <button class="toast-close-btn" onClick={() => props.toasts.dismiss(id())} title="Dismiss">
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

// Both live regions stay in the page, empty or not: a region added together
// with its first message is often not announced. `othersShowing` says a
// toast outside the store (the send toast, passed as children) is up, so an
// error rises above it too.
export function Toasts(props: { toasts: ToastStore; othersShowing?: boolean; children?: JSX.Element }) {
  // Keyed by id so each toast mounts afresh and its progress fill restarts
  const infoIds = () => { const t = props.toasts.current(); return t ? [t.id] : []; };
  const errorIds = () => { const t = props.toasts.error(); return t ? [t.id] : []; };
  const raised = () => !!props.toasts.current() || !!props.othersShowing;
  return (
    <>
      <div role="status" aria-live="polite">
        <For each={infoIds()}>{() => <Toast toast={props.toasts.current()!} toasts={props.toasts} />}</For>
        {props.children}
      </div>
      <div aria-live="assertive">
        <For each={errorIds()}>{() => <Toast toast={props.toasts.error()!} toasts={props.toasts} raised={raised()} />}</For>
      </div>
    </>
  );
}
