import { For, Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { RadialMenu, type RadialItem } from "./RadialMenu";
import { RADIAL_HOVER_OPEN_MS } from "../app/radial";
import type { IconProps } from "./Icons";

// Petals big enough to aim at from the window's corner, just clearing each other
const PETAL = 44;
const RADIUS = 58;
// The + sits in the board's top-left corner: only the quarter from right to
// down has room
const ARC = { start: 0, span: 90 };
// Where a petal's list starts: just past the wheel's rightmost reach
const LEAF_X = RADIUS + PETAL / 2 + 8;

// Who or what a petal starts from, named in full: a person over their
// domain, an event over its guests
export type SlotEntry = {
  id: string;
  label: string;
  title: string;
  detail?: string;
  initial?: string;
  icon?: (props: IconProps) => JSX.Element;
  onSelect: () => void;
};
export type SlotList = { label: string; entries: SlotEntry[] };
export type SlotPetal = RadialItem & { list?: SlotList };

// The board's + bloomed into a quarter wheel of what can be started; a petal
// with people or events to start from lists them beside the wheel, level
// with itself, once the pointer or focus rests on it
export function BoardSlotWheel(props: { open: boolean; petals: SlotPetal[]; onEscape: () => void }) {
  const [listOf, setListOf] = createSignal<string | null>(null);
  let wait: number | undefined;
  onCleanup(() => clearTimeout(wait));
  createEffect(() => {
    if (!props.open) {
      clearTimeout(wait);
      setListOf(null);
    }
  });

  // Resting on a petal opens its list; another petal of the wheel puts it
  // away. Leaving for the list itself keeps it
  const tried = (item: RadialItem | null) => {
    clearTimeout(wait);
    if (!item) return;
    const petal = props.petals.find(p => p.id === item.id);
    if (!petal) return;
    if (!petal.list?.entries.length) setListOf(null);
    else if (listOf() !== petal.id) wait = window.setTimeout(() => setListOf(petal.id), RADIAL_HOVER_OPEN_MS);
  };

  const petalY = (i: number) => {
    const angle = ARC.start + (props.petals.length > 1 ? (i * ARC.span) / (props.petals.length - 1) : ARC.span / 2);
    return Math.round(Math.sin((angle * Math.PI) / 180) * RADIUS);
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
        onScrub={tried}
        onEscape={props.onEscape}
      />
      <For each={props.petals}>
        {(petal, i) => (
          <Show when={petal.list?.entries.length}>
            <SlotLeaf
              list={petal.list!}
              open={props.open && listOf() === petal.id}
              x={LEAF_X}
              y={petalY(i())}
              onEscape={props.onEscape}
            />
          </Show>
        )}
      </For>
    </>
  );
}

// A petal's list: rows of an initial or a glyph, a name and what tells it
// apart. Arrows step through it and Escape leaves the wheel
function SlotLeaf(props: { list: SlotList; open: boolean; x: number; y: number; onEscape: () => void }) {
  const rows: HTMLButtonElement[] = [];
  const onKeyDown = (e: KeyboardEvent) => {
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const count = props.list.entries.length;
    let next = -1;
    if (e.key === "ArrowDown") next = (at + 1) % count;
    else if (e.key === "ArrowUp") next = (at - 1 + count) % count;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.onEscape();
      return;
    }
    if (next < 0 || at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    rows[next]?.focus();
  };
  return (
    <div
      class="board-slot-leaf"
      classList={{ open: props.open }}
      style={{ left: `calc(50% + ${props.x}px)`, top: `calc(50% + ${props.y}px)` }}
      role={props.open ? "menu" : undefined}
      aria-label={props.open ? props.list.label : undefined}
      aria-hidden={!props.open}
      on:keydown={onKeyDown}
    >
      <For each={props.list.entries}>
        {(entry, i) => (
          <button
            ref={(el) => { rows[i()] = el; }}
            type="button"
            class="board-slot-entry"
            role="menuitem"
            aria-label={entry.label}
            title={entry.label}
            tabIndex={props.open && i() === 0 ? 0 : -1}
            onClick={() => entry.onSelect()}
          >
            <span class="board-slot-entry-mark" aria-hidden="true">
              <Show when={entry.icon} fallback={entry.initial}>
                <Dynamic component={entry.icon} size="ui" />
              </Show>
            </span>
            <span class="board-slot-entry-text">
              <span class="board-slot-entry-title">{entry.title}</span>
              <Show when={entry.detail}>
                <span class="board-slot-entry-detail">{entry.detail}</span>
              </Show>
            </span>
          </button>
        )}
      </For>
    </div>
  );
}
