import { Show, createSignal, onCleanup } from "solid-js";
import { RadialMenu, type RadialItem } from "./RadialMenu";
import { CalendarIcon, ComposeIcon, PaletteIcon, SearchIcon } from "./Icons";
import type { FlowerColor } from "./ColorFlower";
import { spreadColor } from "../app/colorSpread";

// Action petals are the size of a row's action wheel; colour petals the size
// of a colour flower's
const ACTION_RADIUS = 38;
const ACTION_PETAL = 28;
const COLOR_RADIUS = 40;
const COLOR_PETAL = 22;
// How far from the window's edges the centre stays, so no petal is cut off
const EDGE = COLOR_RADIUS + COLOR_PETAL;
// The board is a larger area than a card, so its colour spreads more slowly
const BOARD_SPREAD_MS = 460;

// A whole ring, first petal at the top
const ring = (count: number) => ({ start: -90, span: 360 - 360 / Math.max(count, 1) });

// What the board offers where it was double-clicked or right-clicked: a new
// email, a new event, the board's colour or a search. Colour turns the ring
// into the colours, trying each under the pointer as the swatch flower does
export function BoardFlower(props: {
  at: { x: number; y: number };
  colors: FlowerColor[];
  value: string | null;
  onCompose: () => void;
  onEvent: () => void;
  onSearch: () => void;
  onColor: (hue: string | null) => void;
  // Shows a colour being tried; undefined once none is
  onPreview: (hue: string | null | undefined) => void;
  onClose: () => void;
}) {
  let root: HTMLDivElement | undefined;
  const [choosingColor, setChoosingColor] = createSignal(false);
  const x = () => Math.min(Math.max(props.at.x, EDGE), window.innerWidth - EDGE);
  const y = () => Math.min(Math.max(props.at.y, EDGE), window.innerHeight - EDGE);

  // A colour tried spreads across the board from its petal; the colour put
  // back when the try ends just changes
  let shown = props.value;
  const preview = (hue: string | null | undefined) => {
    const deck = root?.closest<HTMLElement>(".deck") ?? document.querySelector<HTMLElement>(".deck");
    const now = hue === undefined ? props.value : hue;
    const petal = hue === undefined ? null : root?.querySelector(hue === null ? ".radial-petal.no-color" : `.radial-petal[data-hue="${hue}"]`);
    const box = petal?.getBoundingClientRect();
    const from = box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
    const apply = () => props.onPreview(hue);
    if (deck) spreadColor(deck, from, apply, { duration: BOARD_SPREAD_MS, was: shown, now, board: true });
    else apply();
    shown = now;
  };

  const close = () => {
    preview(undefined);
    props.onClose();
  };
  const run = (action: () => void) => () => {
    props.onClose();
    action();
  };

  const actions: RadialItem[] = [
    { id: "compose", label: "New email", hint: "C", icon: ComposeIcon, onSelect: run(() => props.onCompose()) },
    { id: "event", label: "New event", hint: "E", icon: CalendarIcon, onSelect: run(() => props.onEvent()) },
    { id: "color", label: "Board color", icon: PaletteIcon, onSelect: () => setChoosingColor(true) },
    { id: "search", label: "Search", hint: "/", icon: SearchIcon, onSelect: run(() => props.onSearch()) },
  ];
  const colors = (): RadialItem[] => [null, ...props.colors].map(color => ({
    id: color?.hue ?? "none",
    label: color?.label ?? "No color",
    hue: color?.hue ?? null,
    selected: props.value === (color?.hue ?? null),
    onSelect: run(() => props.onColor(color?.hue ?? null)),
  }));

  // A press anywhere else, or Escape from anywhere, puts it away
  const onPointerDown = (e: PointerEvent) => {
    if (!root?.contains(e.target as Node)) close();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  onCleanup(() => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
  });

  return (
    <div ref={root} class="board-flower" style={{ left: `${x()}px`, top: `${y()}px` }} data-board>
      <span class="board-flower-core" aria-hidden="true" />
      <Show
        when={choosingColor()}
        fallback={
          <RadialMenu
            label="Board actions"
            open={true}
            items={actions}
            arc={ring(actions.length)}
            radius={ACTION_RADIUS}
            itemSize={ACTION_PETAL}
            hints="always"
            onEscape={close}
          />
        }
      >
        <RadialMenu
          label="Board color"
          open={true}
          items={colors()}
          arc={ring(props.colors.length + 1)}
          radius={COLOR_RADIUS}
          itemSize={COLOR_PETAL}
          onEscape={close}
          onScrub={(item) => preview(item ? item.hue ?? null : undefined)}
        />
      </Show>
    </div>
  );
}
