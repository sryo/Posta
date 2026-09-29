import { createEffect, onCleanup } from "solid-js";
import { isImeComposing, isTypingTarget } from "../shared/keyboard";

// Everything Escape can close that sits over something else (a view, a
// drawer, a picker, a dialog), in the order it opened. One Escape closes the
// layer opened last, and nothing behind it sees the key.
interface Layer {
  close: () => void;
  // Escape typed in a text field closes the layer too, instead of being left
  // to the field (a drawer's search box, which has nothing else to cancel)
  closesFromInputs: boolean;
}

const stack: Layer[] = [];

export function layerCount(): number {
  return stack.length;
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented || isImeComposing(e)) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  if (!top.closesFromInputs && isTypingTarget(e.target)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  top.close();
}

let listening = false;

// Returns the function that removes the layer again
export function pushLayer(close: () => void, { closesFromInputs = false } = {}): () => void {
  if (!listening) {
    // Capture on the document runs before every bubbling document handler
    document.addEventListener("keydown", onKeyDown, true);
    listening = true;
  }
  const layer: Layer = { close, closesFromInputs };
  stack.push(layer);
  return () => {
    const i = stack.indexOf(layer);
    if (i !== -1) stack.splice(i, 1);
  };
}

// A layer held while `open()` is true, dropped with the component
export function useLayer(open: () => boolean, close: () => void, options?: { closesFromInputs?: boolean }) {
  createEffect(() => {
    if (!open()) return;
    onCleanup(pushLayer(() => close(), options));
  });
}
