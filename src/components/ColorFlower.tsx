import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { PaletteIcon } from "./Icons";
import { RadialMenu } from "./RadialMenu";
import { onActivateKey } from "../shared/keyboard";
import { spreadColor } from "../app/colorSpread";

export type FlowerColor = { hue: string; label: string };

// The board (or window) below the strip that drags the window, a petal up
// there would move the window instead of taking the click, and right of the
// board's + column, which petals would cover
function roomFor(menu: HTMLElement) {
  const board = (menu.closest(".deck") ?? document.body).getBoundingClientRect();
  const dragStrip = document.querySelector(".drag-region")?.getBoundingClientRect();
  const plus = document.querySelector(".board-slot-anchor")?.getBoundingClientRect();
  return { left: Math.max(board.left, plus?.right ?? 0), right: board.right, bottom: board.bottom, top: Math.max(board.top, dragStrip?.bottom ?? 0) };
}

// Every colour flower is the same size; only the way it opens differs
const RADIUS = 34;
const PETAL = 20;
const MAX_SPAN = 240;
// Where there is less room than that, the ring grows until the petals clear
// each other rather than crowding
const MIN_SPAN = 150;
const MAX_RADIUS = 60;
const CARD_SPREAD_MS = 340;

// A colour choice: the current colour as a swatch that blooms into a petal per
// colour, "no colour" first. The flower fans toward `toward` as far round as
// the board or window leaves room, floating over whatever is beside it. Hover,
// focus or press and slide across the petals to try each colour; click or let
// go on one to keep it.
export function ColorFlower(props: {
  colors: FlowerColor[];
  value: string | null;
  onChange: (hue: string | null) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  // The swatch's tooltip, and what it is called to assistive tech
  title: string;
  label?: string;
  toward: number;
  compact?: boolean;
  // Shows the colour being tried (hovered, focused or under a held press),
  // and the colour it started from once none is or the flower closes unchosen
  onPreview?: (hue: string | null) => void;
}) {
  // A press on the swatch opens the flower at once, so it can slide straight
  // onto a petal; the click that ends it then doesn't close the flower again
  const [pressed, setPressed] = createSignal(false);
  let openedByPress = false;
  const release = () => setPressed(false);
  document.addEventListener("pointerup", release, true);
  onCleanup(() => document.removeEventListener("pointerup", release, true));

  const toggle = () => props.setOpen(!props.open);
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (openedByPress) openedByPress = false;
    else toggle();
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    setPressed(true);
    if (!props.open) {
      openedByPress = true;
      props.setOpen(true);
    }
  };

  // A colour tried or chosen spreads across the card from its petal; one put
  // back, or that came from elsewhere, just changes
  let root: HTMLDivElement | undefined;
  const fromPetal = (hue: string | null) => {
    const petal = root?.querySelector(hue === null ? ".radial-petal.no-color" : `.radial-petal[data-hue="${hue}"]`);
    if (!petal) return null;
    const box = petal.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };
  const spread = (hue: string | null, from: { x: number; y: number } | null, apply: () => void) => {
    const card = root?.closest<HTMLElement>(".card");
    if (!card) return apply();
    spreadColor(card, from, apply, { duration: CARD_SPREAD_MS, was: props.value, now: hue });
  };

  let before: string | null = null;
  let previewing = false;
  const preview = (hue: string | null | undefined) => {
    const onPreview = props.onPreview;
    if (!onPreview) return;
    if (hue === undefined) {
      const back = before;
      if (previewing) spread(back, null, () => onPreview(back));
      previewing = false;
      return;
    }
    if (!previewing) before = props.value;
    previewing = true;
    spread(hue, fromPetal(hue), () => onPreview(hue));
  };
  createEffect(() => {
    if (!props.open) preview(undefined);
  });

  // The petals are made once per set of colours: previewing a colour changes
  // which one is chosen, and replacing the petals then would pull the one
  // under the pointer out from under it, which reads as leaving and entering
  // it over and over
  const petals = createMemo(() => [null, ...props.colors].map(color => {
    const hue = color?.hue ?? null;
    return {
      id: hue ?? "none",
      label: color?.label ?? "No color",
      hue,
      get selected() { return props.value === hue; },
      onSelect: () => choose(hue),
    };
  }));
  const choose = (hue: string | null) => {
    previewing = false;
    spread(hue, fromPetal(hue), () => props.onChange(hue));
  };
  return (
    <div ref={root} class="color-picker" classList={{ "compact": !!props.compact }}>
      <div
        class="color-picker-selected"
        classList={{ "no-color": props.value === null }}
        data-hue={props.value ?? undefined}
        role="button"
        tabIndex={0}
        title={props.title}
        aria-label={props.label ?? props.title}
        aria-haspopup="menu"
        aria-expanded={props.open}
        onPointerDown={onPointerDown}
        onClick={onClick}
        on:keydown={onActivateKey(toggle)}
      >
        <Show when={props.value === null}>
          <PaletteIcon size={props.compact ? "meta" : "ui"} />
        </Show>
      </div>
      <RadialMenu
        label={props.title}
        open={props.open}
        items={petals()}
        arc={{ toward: props.toward, maxSpan: MAX_SPAN, minSpan: MIN_SPAN }}
        bounds={roomFor}
        radius={RADIUS}
        itemSize={PETAL}
        overlap="grow"
        maxRadius={MAX_RADIUS}
        onEscape={() => { preview(undefined); props.setOpen(false); }}
        pressed={pressed()}
        onScrub={(item) => preview(item ? item.hue ?? null : undefined)}
      />
    </div>
  );
}
