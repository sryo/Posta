import { For, Index, Show } from "solid-js";
import { PlusIcon } from "./Icons";

export type RackCard = { name: string; color?: string | null };

// How long a slot's letters take to drop in before its cards are made
export const SORT_MS = 320;

// Whether letters drop into their slots, or are just there
export function lettersDrop(): boolean {
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// A post office's pigeonhole rack: one slot per card, each with a label
// holder carrying the card's name. Decorative: whoever shows it names the
// cards to screen readers.
export function SortingFrame(props: { cards: RackCard[]; lit?: (index: number) => boolean; filled?: (index: number) => boolean }) {
  return (
    <div class="sorting-frame" aria-hidden="true">
      <Show
        when={props.cards.length > 0}
        fallback={
          <div class="sorting-slot bare">
            <div class="sorting-cubby"><PlusIcon size="tool" /></div>
            <span class="sorting-label">{" "}</span>
          </div>
        }
      >
        <Index each={props.cards}>
          {(card, i) => (
            <div
              class="sorting-slot"
              data-hue={card().color || undefined}
              classList={{ "lit": props.lit?.(i) ?? false, "filled": props.filled?.(i) ?? false }}
            >
              <div class="sorting-cubby">
                <For each={[0, 1, 2]}>{() => <span class="sorting-letter"></span>}</For>
              </div>
              <span class="sorting-label">{card().name}</span>
            </div>
          )}
        </Index>
      </Show>
    </div>
  );
}
