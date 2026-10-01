// Motion played from script. App.css's reduced-motion rule only reaches CSS
// animations and transitions, so anything played with element.animate()
// checks the setting here.

// The curves App.css writes out: settling in, and leaving
export const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
export const EASE_IN_OUT = "cubic-bezier(0.4, 0, 0.2, 1)";

export function reducedMotion(): boolean {
  return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

type Rect = Pick<DOMRect, "top" | "left" | "right" | "bottom">;

// A clip-path that shows only `rect` of an element covering `box`
export function insetClip(rect: Rect, box: Rect, radius = 0): string {
  const px = (n: number) => `${Math.round(n)}px`;
  return `inset(${px(rect.top - box.top)} ${px(box.right - rect.right)} ${px(box.bottom - rect.bottom)} ${px(rect.left - box.left)} round ${px(radius)})`;
}

// Plays the motion, or under reduced motion the `reduced` keyframes (a fade)
// for `reducedMs`, or nothing
export function play(
  el: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  reduced?: Keyframe[],
  reducedMs = 120,
): Animation | null {
  if (typeof el.animate !== "function") return null;
  if (!reducedMotion()) return el.animate(keyframes, options);
  return reduced ? el.animate(reduced, { duration: reducedMs, fill: options.fill }) : null;
}

export const FOLD_MS = 240;

// Folds a part of a form away to nothing (App.css [data-folded]), out of
// reach of focus and screen readers, or opens it to its own height again.
// Starts from wherever a fold under way got to.
export function fold(el: HTMLElement, open: boolean, ms = FOLD_MS) {
  const from = el.getBoundingClientRect().height;
  const style = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
  const padding = (s: CSSStyleDeclaration | null) => ({ paddingTop: s?.paddingTop || "0px", paddingBottom: s?.paddingBottom || "0px" });
  const fromPadding = padding(style);
  el.getAnimations?.().forEach(a => a.cancel());
  if (open) {
    el.removeAttribute("data-folded");
    el.removeAttribute("aria-hidden");
  } else {
    el.setAttribute("data-folded", "");
    el.setAttribute("aria-hidden", "true");
  }
  el.inert = !open;
  const to = el.getBoundingClientRect().height;
  const toPadding = open ? padding(style) : { paddingTop: "0px", paddingBottom: "0px" };
  if (ms <= 0) return;
  play(el, [
    { height: `${from}px`, opacity: open ? 0 : 1, overflow: "hidden", ...fromPadding },
    { height: `${to}px`, opacity: open ? 1 : 0, overflow: "hidden", ...toPadding },
  ], { duration: ms, easing: EASE_OUT });
}

// Eases an element from its height before `change` to the one after
export function morphHeight(el: HTMLElement, change: () => void, ms = FOLD_MS) {
  const from = el.getBoundingClientRect().height;
  el.getAnimations?.().forEach(a => a.cancel());
  change();
  const to = el.getBoundingClientRect().height;
  if (ms > 0 && from !== to) play(el, [{ height: `${from}px` }, { height: `${to}px` }], { duration: ms, easing: EASE_OUT });
}
