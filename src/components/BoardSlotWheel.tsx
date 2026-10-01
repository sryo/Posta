import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { RadialMenu, type RadialItem } from "./RadialMenu";
import { RADIAL_HOVER_OPEN_MS, type Rect } from "../app/radial";

// Petals big enough to aim at from the window's corner, just clearing each
// other on both rings
const PETAL = 44;
const GAP = 4;
const RADIUS = 58;
const RING_RADIUS = 52;
// The angle between neighbours on a ring where petals just clear
const RING_STEP = (2 * Math.asin((PETAL + GAP) / 2 / RING_RADIUS) * 180) / Math.PI;
// The + sits in the board's top-left corner: only the quarter from right to
// down has room
const ARC = { start: 0, span: 90 };

// What a petal opens around itself while it is tried: who to write to, what
// to plan again
export type SlotRing = { label: string; items: RadialItem[] };
export type SlotPetal = RadialItem & { ring?: SlotRing };

// Right of the + and anywhere below the window's top: a ring that would
// cross the window's left edge turns away from it
const beside = (menu: HTMLElement): Rect | undefined => {
  const slot = menu.closest(".board-slot")?.getBoundingClientRect();
  return slot && { left: slot.left, top: 0, right: window.innerWidth, bottom: window.innerHeight };
};

// The board's + bloomed into a quarter wheel of what can be started; a petal
// with people or events to start from rings them round itself once the
// pointer or focus rests on it
export function BoardSlotWheel(props: { open: boolean; petals: SlotPetal[]; onEscape: () => void }) {
  const [ringOf, setRingOf] = createSignal<string | null>(null);
  let wait: number | undefined;
  onCleanup(() => clearTimeout(wait));
  createEffect(() => {
    if (!props.open) {
      clearTimeout(wait);
      setRingOf(null);
    }
  });

  // Resting on a petal opens its ring; another petal of the wheel puts it
  // away. Leaving for the ring itself keeps it
  const tried = (item: RadialItem | null) => {
    clearTimeout(wait);
    if (!item) return;
    const petal = props.petals.find(p => p.id === item.id);
    if (!petal) return;
    if (!petal.ring?.items.length) setRingOf(null);
    else if (ringOf() !== petal.id) wait = window.setTimeout(() => setRingOf(petal.id), RADIAL_HOVER_OPEN_MS);
  };

  const angle = (i: number) => ARC.start + (props.petals.length > 1 ? (i * ARC.span) / (props.petals.length - 1) : ARC.span / 2);
  const at = (i: number) => {
    const a = (angle(i) * Math.PI) / 180;
    return { x: Math.round(Math.cos(a) * RADIUS), y: Math.round(Math.sin(a) * RADIUS) };
  };

  return (
    <>
      <RadialMenu
        label="New"
        items={props.petals}
        open={props.open}
        arc={ARC}
        radius={RADIUS}
        itemSize={PETAL}
        hints="always"
        class="board-slot-wheel"
        onScrub={tried}
        onEscape={props.onEscape}
      />
      <For each={props.petals}>
        {(petal, i) => (
          <Show when={petal.ring?.items.length}>
            <div class="board-slot-ring" style={{ left: `calc(50% + ${at(i()).x}px)`, top: `calc(50% + ${at(i()).y}px)` }}>
              <RadialMenu
                label={petal.ring!.label}
                items={petal.ring!.items}
                open={props.open && ringOf() === petal.id}
                arc={{ toward: angle(i()), maxSpan: RING_STEP * (petal.ring!.items.length - 1), minSpan: RING_STEP * (petal.ring!.items.length - 1) }}
                radius={RING_RADIUS}
                itemSize={PETAL}
                bounds={beside}
                class="board-slot-wheel"
                onEscape={props.onEscape}
              />
            </div>
          </Show>
        )}
      </For>
    </>
  );
}
