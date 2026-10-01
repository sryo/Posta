// Motion driven from script (the Web Animations API, a moving ring) is out of
// reach of the stylesheet's reduced-motion rule, so it asks here and falls
// back to a fade or to no motion at all

export function reducedMotion(): boolean {
  return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Things arriving where they settle: the stylesheet's
// cubic-bezier(0.2, 0.8, 0.2, 1), as composing panels and postmarks use it
export const EASE_SETTLE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
// Things leaving: the radial menus' exit curve (--radial-exit)
export const EASE_EXIT = "cubic-bezier(0.4, 0, 1, 1)";

// An animation's end, whether it finished or was cancelled; resolves at once
// where the Web Animations API is missing
export function settled(animation: Animation | undefined): Promise<void> {
  return animation ? animation.finished.then(() => {}, () => {}) : Promise.resolve();
}
