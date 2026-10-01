import { createSignal } from "solid-js";
import { isTypingTarget } from "../shared/keyboard";

// Whether the user is working from the keyboard or the pointer right now, as
// a browser decides when to draw focus rings. Key hints and the focused row's
// wheel belong to the keyboard: the keys act on the focused row, not the one
// under the pointer. The page carries it as data-input, for CSS.
export type InputMode = "keyboard" | "pointer";

const [mode, setMode] = createSignal<InputMode>("pointer");
export const inputMode = mode;

export function setInputMode(next: InputMode) {
  setMode(next);
  document.documentElement.dataset.input = next;
}

const MODIFIERS = new Set(["Shift", "Meta", "Control", "Alt", "CapsLock", "Fn"]);
let last: { x: number; y: number } | null = null;

function onKeyDown(e: KeyboardEvent) {
  if (MODIFIERS.has(e.key)) return;
  // Typing in a field acts on the field; Tab out of one moves among the rows
  if (isTypingTarget(e.target) && e.key !== "Tab") return;
  if (mode() !== "keyboard") setInputMode("keyboard");
}

// WebKit sends a move when the list scrolls under a still mouse; only a mouse
// that went somewhere on screen counts
function onPointerMove(e: PointerEvent) {
  const moved = !last || last.x !== e.screenX || last.y !== e.screenY;
  last = { x: e.screenX, y: e.screenY };
  if (moved && mode() !== "pointer") setInputMode("pointer");
}

function onPointerDown(e: PointerEvent) {
  last = { x: e.screenX, y: e.screenY };
  if (mode() !== "pointer") setInputMode("pointer");
}

if (typeof document !== "undefined") {
  setInputMode("pointer");
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerdown", onPointerDown, true);
}
