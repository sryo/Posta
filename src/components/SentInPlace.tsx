import { createEffect, createMemo, createSignal, on, onCleanup, Show, type JSX } from "solid-js";
import { fold, morphHeight } from "../shared/motion";
import { formatWhen } from "../app/dateFormat";

export type SentInPlaceState = {
  state: "sending" | "sent";
  sentAt?: number;
  undoUntil: number;
  onUndo?: () => void;
};

// Who wrote it, then "Sending" with an Undo and a bar running out with the
// time left to undo, or when it went
export function SentHead(props: SentInPlaceState) {
  const canUndo = () => props.state === "sending" && props.undoUntil > Date.now() && !!props.onUndo;
  const [undoable, setUndoable] = createSignal(canUndo());
  createEffect(() => {
    const left = props.undoUntil - Date.now();
    setUndoable(canUndo());
    if (left <= 0) return;
    const timer = setTimeout(() => setUndoable(false), left);
    onCleanup(() => clearTimeout(timer));
  });
  return (
    <div class="sent-head">
      <div class="sent-head-line">
        <span class="message-sender">You</span>
        <span class="sent-state message-date">
          <Show when={props.state === "sent"} fallback={<span class="sent-when">Sending</span>}>
            <span class="sent-when">{formatWhen(new Date(props.sentAt ?? Date.now()), new Date())}</span>
          </Show>
          <Show when={undoable()}>
            <button type="button" class="sent-undo" onClick={() => props.onUndo?.()}>Undo</button>
          </Show>
        </span>
      </div>
      <Show when={undoable()}>
        <div class="sent-undo-bar" style={{ "animation-duration": `${Math.max(0, props.undoUntil - Date.now())}ms` }} />
      </Show>
    </div>
  );
}

// The parts of a compose box that fold away once it is sent: everything but
// the words, its files and the drop overlay
function controls(box: HTMLElement): HTMLElement[] {
  const keep = (el: Element) => el.matches(".sent-head, .compose-drop-zone, .compose-body, .compose-content, .compose-attachments, .compose-drop-overlay, textarea");
  const zone = box.querySelector(".compose-drop-zone") ?? box;
  const body = zone.querySelector(".compose-body");
  const content = body?.querySelector(".compose-content");
  return [zone, body, content]
    .flatMap(parent => (parent ? Array.from(parent.children) : []))
    .filter((el): el is HTMLElement => el instanceof HTMLElement && !keep(el));
}

// A compose box that becomes the thing it sent, in place: once `sent` is set
// its controls fold away and SentHead opens over the same words, which can't
// be edited; once it is clear again the box is a compose box again, the
// caret back where it was. Whoever shows it keeps the compose rendered
// (with what was sent) while `sent` is set.
export function SentInPlace(props: { class: string; sent?: SentInPlaceState | null; children: JSX.Element }) {
  let box!: HTMLDivElement;
  let head!: HTMLDivElement;
  let caret: [number, number] = [0, 0];
  let sentText: string | null = null;
  // The head keeps its words while folding shut after an undo
  const shownHead = createMemo<SentInPlaceState | null>(last => props.sent ?? last, null);
  const isSent = createMemo(() => !!props.sent);

  const fitText = (text: HTMLTextAreaElement, sent: boolean, ms?: number) => morphHeight(text, () => {
    text.style.height = "";
    if (!sent) return;
    text.style.height = "0px";
    text.style.height = `${text.scrollHeight}px`;
  }, ms);

  createEffect(on(isSent, (sent, was) => {
    const text = box.querySelector("textarea");
    // Mounted as it is: nothing to fold from
    const ms = was === undefined ? 0 : undefined;
    if (sent) {
      const focusInside = box.contains(document.activeElement);
      if (text) {
        caret = [text.selectionStart, text.selectionEnd];
        sentText = text.value;
        text.readOnly = true;
        fitText(text, true, ms);
      }
      for (const part of controls(box)) fold(part, false, ms);
      fold(head, true, ms);
      if (focusInside) head.querySelector<HTMLElement>(".sent-undo")?.focus({ preventScroll: true });
      return;
    }
    fold(head, false, ms);
    if (was === undefined) return;
    for (const part of controls(box)) fold(part, true, ms);
    if (!text) return;
    text.readOnly = false;
    fitText(text, false, ms);
    text.focus({ preventScroll: true });
    const at = text.value === sentText ? caret : [0, 0];
    text.setSelectionRange(at[0], at[1]);
  }));

  return (
    <div ref={box} class={props.class} classList={{ sent: isSent() }}>
      <div ref={head}>
        <Show when={shownHead()}>{(h) => <SentHead {...h()} />}</Show>
      </div>
      {props.children}
    </div>
  );
}
