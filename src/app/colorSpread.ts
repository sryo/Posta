import { EASE_SETTLE, reducedMotion, settled } from "./motion";

export interface SpreadOptions {
  duration: number;
  // The hues by name, before and after; null is no colour
  was: string | null;
  now: string | null;
  // The board's colour, across the window, rather than a card's in its box
  board?: boolean;
}

const running = new WeakMap<HTMLElement, () => void>();

// Changes `host`'s colour by running `apply`, and lets the new colour grow
// from `from` (where it was chosen, in window coordinates) over the old one
// until it covers the host. Both colours are painted by the stylesheet from
// their hue's name, on layers behind the host's content. Without a point (a
// colour put back, or that came from elsewhere) it just changes; with
// reduced motion the old colour fades out in place.
export function spreadColor(host: HTMLElement, from: { x: number; y: number } | null, apply: () => void, options: SpreadOptions) {
  running.get(host)?.();
  if (!from || options.was === options.now || typeof host.animate !== "function") {
    apply();
    return;
  }
  const oldRing = getComputedStyle(host).boxShadow;
  apply();
  const newRing = getComputedStyle(host).boxShadow;

  const layer = (hue: string | null) => {
    const el = document.createElement("div");
    el.className = options.board ? "color-spread board" : "color-spread";
    if (hue) el.dataset.hue = hue;
    el.setAttribute("aria-hidden", "true");
    host.prepend(el);
    return el;
  };

  host.classList.add("color-spreading");
  const animations: Animation[] = [];
  if (reducedMotion()) {
    const old = layer(options.was);
    animations.push(old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: "linear", fill: "forwards" }));
  } else {
    // The old colour first, under the new
    const fresh = layer(options.now);
    layer(options.was);
    const area = options.board
      ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
      : host.getBoundingClientRect();
    const x = Math.round(from.x - area.left);
    const y = Math.round(from.y - area.top);
    const radius = Math.round(Math.max(
      Math.hypot(x, y), Math.hypot(area.width - x, y), Math.hypot(x, area.height - y), Math.hypot(area.width - x, area.height - y),
    ));
    const timing = { duration: options.duration, easing: EASE_SETTLE, fill: "forwards" as const };
    animations.push(fresh.animate([{ clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(${radius}px at ${x}px ${y}px)` }], timing));
    if (newRing !== oldRing) animations.push(host.animate([{ boxShadow: oldRing }, { boxShadow: newRing }], timing));
  }

  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    running.delete(host);
    for (const animation of animations) animation.cancel();
    host.querySelectorAll(":scope > .color-spread").forEach(el => el.remove());
    host.classList.remove("color-spreading");
  };
  running.set(host, end);
  Promise.all(animations.map(settled)).then(end);
}
