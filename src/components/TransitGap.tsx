import { createSignal, onCleanup, onMount } from "solid-js";
import type { Transit } from "../app/transit";

// Every stamp in view waits on one observer, dropped once none is left to land
const landings = new Map<Element, () => void>();
let observer: IntersectionObserver | null = null;

function landWhenSeen(stamp: Element, land: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {};
  const forget = (el: Element) => {
    landings.delete(el);
    observer?.unobserve(el);
    if (landings.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      landings.get(entry.target)?.();
      forget(entry.target);
    }
  });
  landings.set(stamp, land);
  observer.observe(stamp);
  return () => { if (landings.has(stamp)) forget(stamp); };
}

// A long silence in a thread: the post office's straight boxed handstamp
// between the two letters, joined to both by a dashed line, in the ink of the
// card the thread was opened from. It lands the first time it scrolls into view.
export const TransitGap = (props: { transit: Transit; hue?: string | null }) => {
  let stamp: SVGSVGElement | undefined;
  const [landed, setLanded] = createSignal(false);
  onMount(() => onCleanup(landWhenSeen(stamp!, () => setLanded(true))));
  return (
    <div class="transit" role="note" aria-label={props.transit.label} data-hue={props.hue || undefined}>
      <span class="transit-line" aria-hidden="true" />
      <svg ref={stamp} class={landed() ? "postmark transit-stamp lands" : "postmark transit-stamp"} viewBox="0 0 150 64" aria-hidden="true">
        <g filter="url(#postmark-ink)" fill="none" stroke="currentColor">
          <rect x="2" y="2" width="146" height="60" rx="9" stroke-width="1.7" />
          <rect x="6" y="6" width="138" height="52" rx="6" stroke-width="0.8" />
          <path d="M16 22 H134 M16 46 H134" stroke-width="0.8" />
          <g class="postmark-text" fill="currentColor" stroke="none">
            <text x="75" y="17.2" font-size="6.6" text-anchor="middle" letter-spacing="2.2">IN TRANSIT</text>
            <text x="75" y="39" font-size="13" text-anchor="middle" letter-spacing="1">{props.transit.span}</text>
            <text x="75" y="54.4" font-size="5.6" text-anchor="middle" letter-spacing="1.2">{props.transit.range}</text>
          </g>
        </g>
      </svg>
      <span class="transit-line" aria-hidden="true" />
    </div>
  );
};
