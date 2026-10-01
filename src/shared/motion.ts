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
