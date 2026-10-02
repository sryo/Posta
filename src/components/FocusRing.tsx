import { createEffect, onCleanup, onMount } from "solid-js";
import { ringPlacement } from "../app/ringPlacement";
import { reducedMotion } from "../app/motion";

export type RingBump = { toward: "down" | "up" | "side"; at: number };

// The board's one keyboard focus ring. It glides from row to row as the focus
// moves, in the colour of the card it is in, and is cut to the row's list so
// it never draws past the card. A row that moves under it (a scroll, rows
// coming and going) takes it along at once. Pressed against an edge, it
// nudges toward it. The row is looked up each frame, so the ring finds it
// however the list re-rendered.
export function FocusRing(props: { target: () => HTMLElement | null; hue?: string; bump: RingBump | null }) {
  let ring!: HTMLDivElement;
  let shown: HTMLElement | null = null;
  let last = "";
  let frame = 0;

  const place = () => {
    const target = props.target();
    if (!target?.isConnected) {
      if (shown) ring.style.width = ring.style.height = "0px";
      shown = null;
      last = "";
      return;
    }
    const list = target.closest(".card-body") ?? target.parentElement ?? target;
    const box = ringPlacement(target.getBoundingClientRect(), list.getBoundingClientRect());
    const key = `${box.x},${box.y},${box.width},${box.height},${box.clip}`;
    const moved = target !== shown;
    if (!moved && key === last) return;
    // Only a change of row glides; the first placing and a row that moved
    // under the ring follow at once
    ring.classList.toggle("instant", !moved || shown === null || reducedMotion());
    shown = target;
    last = key;
    ring.style.transform = `translate(${box.x}px, ${box.y}px)`;
    ring.style.width = `${box.width}px`;
    ring.style.height = `${box.height}px`;
    ring.style.clipPath = box.clip;
  };
  const loop = () => {
    place();
    frame = requestAnimationFrame(loop);
  };
  onMount(() => { frame = requestAnimationFrame(loop); });
  onCleanup(() => cancelAnimationFrame(frame));

  createEffect(() => {
    const bump = props.bump;
    if (!bump) return;
    ring.removeAttribute("data-bump");
    void ring.offsetWidth;
    ring.dataset.bump = bump.toward;
  });

  return <div ref={ring} class="focus-ring" data-hue={props.hue} aria-hidden="true" />;
}
