import { For, Show, type JSX } from "solid-js";
import { IconButton } from "./IconButton";
import { KeyHint } from "./KeyHint";
import { toastActions, type createToasts, type ShownToast } from "../app/toasts";
import { CloseIcon } from "./Icons";

type ToastStore = ReturnType<typeof createToasts>;

// A toast's look: a dark bar at the bottom with a message, its actions and a
// fill that shows the time left. The fill runs by itself over `durationMs`,
// or follows `percent` when the caller counts the time (the send toast).
export function ToastFrame(props: {
  message: JSX.Element;
  note?: JSX.Element;
  closing?: boolean;
  paused?: boolean;
  raised?: boolean;
  durationMs?: number | null;
  percent?: number;
  onPause?: () => void;
  onResume?: () => void;
  onDismiss?: () => void;
  children?: JSX.Element;
}) {
  return (
    <div
      class={`undo-toast${props.closing ? " closing" : ""}${props.paused ? " paused" : ""}${props.raised ? " raised" : ""}`}
      onMouseEnter={() => props.onPause?.()}
      onMouseLeave={(e) => {
        if (!e.currentTarget.contains(document.activeElement)) props.onResume?.();
      }}
      onFocusIn={() => props.onPause?.()}
      onFocusOut={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) props.onResume?.();
      }}
    >
      <Show
        when={props.percent === undefined}
        fallback={<div class="toast-progress" data-driven="" style={{ width: `${props.percent}%` }}></div>}
      >
        <Show when={props.durationMs}>
          {(ms) => <div class="toast-progress" style={{ "animation-duration": `${ms()}ms` }}></div>}
        </Show>
      </Show>
      <div class="toast-content">
        <span class="toast-message">
          {props.message}
          <Show when={props.note}><span class="toast-note">{props.note}</span></Show>
        </span>
        {props.children}
        <Show when={props.onDismiss}>
          {(dismiss) => (
            <IconButton label="Dismiss" size="sm" tone="inverse" onClick={() => dismiss()()}>
              <CloseIcon />
            </IconButton>
          )}
        </Show>
      </div>
    </div>
  );
}

function Toast(props: { toast: ShownToast; toasts: ToastStore; raised?: boolean }) {
  const t = () => props.toast;
  const id = () => props.toast.id;
  return (
    <ToastFrame
      message={t().message}
      note={t().note}
      closing={t().closing}
      paused={t().paused}
      raised={props.raised}
      durationMs={t().durationMs}
      onPause={() => props.toasts.pause(id())}
      onResume={() => props.toasts.resume(id())}
      onDismiss={() => props.toasts.dismiss(id())}
    >
      <Show when={t().undo}>
        <button class="toast-undo-btn" onClick={() => props.toasts.undo()}>Undo <KeyHint keys="z" /></button>
      </Show>
      <For each={toastActions(t())}>
        {(action, i) => (
          <button class="toast-undo-btn" onClick={() => props.toasts.runAction(i(), id())}>
            {action.label}<Show when={action.keys}>{(keys) => <> <KeyHint keys={keys()} /></>}</Show>
          </button>
        )}
      </For>
    </ToastFrame>
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
