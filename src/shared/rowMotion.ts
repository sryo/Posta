import { createSignal, onMount } from "solid-js";
import { EASE_IN_OUT, EASE_OUT, insetClip, play } from "./motion";

export const GROW_MS = 300;
export const SHRINK_MS = 220;
// A row's corners, which the overlay starts from and ends at
const ROW_RADIUS = 8;

const viewport = () => ({ top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight });

// The row's rect while any of it is on screen
function shownRect(row: Element | null | undefined): DOMRect | null {
  const rect = row?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) return null;
  if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return null;
  return rect;
}

// A full-window overlay that grows out of the row it was opened from, its
// content rising in after, and shrinks back into that row, measured again,
// on closing. Without a row on screen it leaves the overlay to its CSS
// slide; viaRow() says when it doesn't. Under reduced motion it fades.
export function createRowMotion(origin: () => Element | null | undefined) {
  const [viaRow, setViaRow] = createSignal(false);
  let overlay: HTMLElement | undefined;
  let running: Animation | null = null;

  onMount(() => {
    const rect = shownRect(origin());
    if (!overlay || !rect) return;
    const box = viewport();
    running = play(overlay,
      [{ clipPath: insetClip(rect, box, ROW_RADIUS) }, { clipPath: insetClip(box, box, 0) }],
      { duration: GROW_MS, easing: EASE_OUT },
      [{ opacity: 0 }, { opacity: 1 }]);
    if (!running) return;
    setViaRow(true);
    const content = overlay.querySelector(".thread-content");
    if (content) {
      play(content, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 180, delay: 120, easing: EASE_OUT, fill: "backwards" });
    }
  });

  // From wherever the opening got to, so closing midway turns it around
  const close = () => {
    const rect = shownRect(origin());
    if (!overlay || !rect) {
      running?.cancel();
      setViaRow(false);
      return;
    }
    const box = viewport();
    const current = getComputedStyle(overlay).clipPath;
    running?.cancel();
    running = play(overlay,
      [{ clipPath: current && current !== "none" ? current : insetClip(box, box, 0) }, { clipPath: insetClip(rect, box, ROW_RADIUS) }],
      { duration: SHRINK_MS, easing: EASE_IN_OUT, fill: "forwards" },
      [{ opacity: 1 }, { opacity: 0 }]);
    setViaRow(!!running);
  };

  return { ref: (el: HTMLElement) => { overlay = el; }, viaRow, close };
}

export const RETURN_LIGHT_MS = 1100;
const lightTimers = new WeakMap<Element, number>();

// Lights the row a view went back to for a moment (App.css [data-returned]),
// from the start again when it is lit already
export function lightUp(row: HTMLElement) {
  clearTimeout(lightTimers.get(row));
  row.removeAttribute("data-returned");
  void row.offsetWidth;
  row.setAttribute("data-returned", "");
  lightTimers.set(row, window.setTimeout(() => row.removeAttribute("data-returned"), RETURN_LIGHT_MS));
}
