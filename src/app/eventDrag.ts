// Dragging an event row to another time or day in its calendar card. A drop
// target carries data-move-target: "day:<midnight ms>" keeps the event's clock
// time on that day, "at:<ms>" starts it then. While held over one, the target
// says whether the event is free there, before it is let go.

import { createSignal, onCleanup } from "solid-js";
import type { GoogleCalendarEvent } from "../api/tauri";
import { sameTimeOn } from "./eventMove";

const DRAG_THRESHOLD_PX = 5;

export interface DragVerdict {
  free: boolean;
  text: string;
}

export interface DraggedEvent {
  event: GoogleCalendarEvent;
  cardId: string;
  x: number;
  y: number;
  target: { key: string; start: number } | null;
}

export function createEventDrag(options: {
  verdict: (event: GoogleCalendarEvent, start: number, cardId: string) => DragVerdict;
  // Why the event can't be moved; null when it can
  refusal: (event: GoogleCalendarEvent, cardId: string) => string | null;
  onDrop: (event: GoogleCalendarEvent, cardId: string, start: number) => void;
}) {
  const [dragged, setDragged] = createSignal<DraggedEvent | null>(null);
  let stop: (() => void) | undefined;

  function targetAt(x: number, y: number, event: GoogleCalendarEvent, within: Element | null) {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-move-target]");
    if (!el || !within?.contains(el)) return null;
    const key = el.dataset.moveTarget!;
    const [kind, value] = key.split(":");
    const ms = Number(value);
    if (!Number.isFinite(ms)) return null;
    return { key, start: kind === "day" ? sameTimeOn(event, new Date(ms)) : ms };
  }

  // The click a drag ends with lands in the card, on the row or on what holds
  // both it and the target, and would open the event
  function swallowNextClick(within: Element | null) {
    const swallow = (e: MouseEvent) => {
      if (!within?.contains(e.target as Node)) return;
      e.stopPropagation();
      e.preventDefault();
      window.removeEventListener("click", swallow, true);
    };
    window.addEventListener("click", swallow, true);
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
  }

  function press(e: PointerEvent, event: GoogleCalendarEvent, cardId: string) {
    if (e.button !== 0) return;
    const pressed = e.target as Element | null;
    if (pressed?.closest("button, a, input, textarea, select, [contenteditable]")) return;
    stop?.();
    const within = pressed?.closest(".card-body") ?? null;
    const origin = { x: e.clientX, y: e.clientY };
    let started = false;

    const move = (m: MouseEvent) => {
      if (!started && Math.hypot(m.clientX - origin.x, m.clientY - origin.y) < DRAG_THRESHOLD_PX) return;
      if (!started) document.body.classList.add("dragging-event");
      started = true;
      m.preventDefault();
      setDragged({ event, cardId, x: m.clientX, y: m.clientY, target: targetAt(m.clientX, m.clientY, event, within) });
    };
    const up = () => {
      const drop = dragged()?.target;
      end();
      if (!started) return;
      swallowNextClick(within);
      if (drop && drop.start !== event.start_time && !options.refusal(event, cardId)) options.onDrop(event, cardId, drop.start);
    };
    const key = (k: KeyboardEvent) => {
      if (k.key !== "Escape" || !started) return;
      k.preventDefault();
      k.stopPropagation();
      end();
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", key, true);
      document.body.classList.remove("dragging-event");
      setDragged(null);
      stop = undefined;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", key, true);
    stop = end;
  }

  onCleanup(() => stop?.());

  return {
    dragged,
    press,
    isDragged: (eventId: string, cardId: string) => dragged()?.event.id === eventId && dragged()?.cardId === cardId,
    // What a target says while the event is held over it
    verdictAt(key: string): DragVerdict | null {
      const drag = dragged();
      if (!drag?.target || drag.target.key !== key || drag.target.start === drag.event.start_time) return null;
      const refusal = options.refusal(drag.event, drag.cardId);
      return refusal ? { free: false, text: refusal } : options.verdict(drag.event, drag.target.start, drag.cardId);
    },
  };
}
