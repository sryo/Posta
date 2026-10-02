import { createSignal } from "solid-js";

export interface RowDragState {
  threadId: string;
  sourceCardId: string;
  // The card under the pointer, the source card included
  overCardId: string | null;
  alt: boolean;
}

type Box = { left: number; top: number; width: number; height: number };

// A press on these is the control's, not the start of a drag
const CONTROLS = "button, a, input, textarea, select, .thread-checkbox-wrap, .radial-menu, .invite-answer, .quick-reply-box";
// How far the pointer moves before a press becomes a drag
const SLOP = 5;

// Dragging a thread row onto a card, with the pointer. A raised copy of the
// row follows the pointer while the row dims; the card under it and ⌥ are
// kept for the cards to say what a drop would do. Letting go calls `onDrop`
// with where the copy was, and the click that ends the drag opens nothing.
// Escape puts the row back.
export function createRowDrag(handlers: { onDrop: (drop: RowDragState, at: Box) => void; onStart?: (drag: RowDragState) => void }) {
  const [dragging, setDragging] = createSignal<RowDragState | null>(null);
  let cancel = () => {};

  function press(e: PointerEvent, sourceCardId: string, threadId: string) {
    if (e.button !== 0 || (e.target as Element).closest?.(CONTROLS)) return;
    const row = e.currentTarget as HTMLElement;
    const start = { x: e.clientX, y: e.clientY };
    let ghost: HTMLElement | null = null;
    let offset = { x: 0, y: 0 };

    const over = (x: number, y: number) =>
      (document.elementFromPoint(x, y)?.closest<HTMLElement>(".card[data-id]")?.dataset.id) ?? null;
    const move = (ev: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < SLOP) return;
        ghost = lift(row);
        const box = row.getBoundingClientRect();
        offset = { x: Math.min(start.x - box.left, 24), y: Math.min(start.y - box.top, 16) };
        row.classList.add("lifting");
        document.documentElement.classList.add("row-dragging");
        const state = { threadId, sourceCardId, overCardId: null, alt: ev.altKey };
        setDragging(state);
        handlers.onStart?.(state);
      }
      ghost.style.transform = `translate(${ev.clientX - offset.x}px, ${ev.clientY - offset.y}px)`;
      setDragging(d => d && { ...d, overCardId: over(ev.clientX, ev.clientY), alt: ev.altKey });
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && ghost) {
        ev.preventDefault();
        ev.stopPropagation();
        end();
      } else if (ev.key === "Alt") {
        setDragging(d => d && { ...d, alt: ev.type === "keydown" });
      }
    };
    const up = () => {
      const state = dragging();
      const box = ghost?.getBoundingClientRect();
      if (state && ghost) swallowReleaseClick();
      end();
      if (state?.overCardId && box) handlers.onDrop(state, { left: box.left, top: box.top, width: box.width, height: box.height });
    };
    const end = () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", end, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("keyup", key, true);
      ghost?.remove();
      ghost = null;
      row.classList.remove("lifting");
      document.documentElement.classList.remove("row-dragging");
      setDragging(null);
    };
    cancel = end;
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", end, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("keyup", key, true);
  }

  return { dragging, press, cancel: () => cancel() };
}

// The click a drag's release makes is the drag's: on a row it would open
// the thread, on a card's header fold the card. It comes straight after the
// release, before the next press.
function swallowReleaseClick() {
  const off = () => {
    window.removeEventListener("click", swallow, true);
    document.removeEventListener("pointerdown", off, true);
  };
  const swallow = (e: MouseEvent) => {
    if (!(e.target as Element).closest?.(".thread, .card-header")) return;
    e.stopPropagation();
    e.preventDefault();
    off();
  };
  window.addEventListener("click", swallow, true);
  document.addEventListener("pointerdown", off, true);
  setTimeout(off, 0);
}

// The row's raised copy, without its controls, at the window's corner until
// moved under the pointer
function lift(row: HTMLElement): HTMLElement {
  const ghost = row.cloneNode(true) as HTMLElement;
  ghost.querySelectorAll(".thread-checkbox-wrap, .quick-reply-box").forEach(el => el.remove());
  ghost.classList.remove("focused", "selected", "lifting");
  ghost.classList.add("row-ghost");
  for (const name of ["tabindex", "role", "aria-label", "data-thread-id"]) ghost.removeAttribute(name);
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.width = `${row.getBoundingClientRect().width}px`;
  document.body.append(ghost);
  return ghost;
}
