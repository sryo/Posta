import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { IconProps } from "./Icons";
import { autoArc, layoutPetals, type Arc, type Overlap } from "../app/radial";

// One petal: an action with an icon, or a colour swatch (`hue`, null for none)
export type RadialItem = {
  id: string;
  label: string;
  hint?: string;
  icon?: (props: IconProps) => JSX.Element;
  hue?: string | null;
  selected?: boolean;
  danger?: boolean;
  onSelect: (e: MouseEvent) => void;
};

// Opens toward a direction, as wide as the room around it allows
export type ArcToward = { toward: number; maxSpan: number };

// How far a hovered petal lifts outward, and how far outside it its key hint sits
const LIFT = 3;
const HINT_GAP = 6;

// Every pie in the app: the row actions, a message's replies and the colour
// flowers. Petals bloom out from the anchor's centre along their angles,
// overlapping where the ring is tight; the hovered or focused one comes to
// the front. Arrow keys step round the ring and Escape leaves it.
export function RadialMenu(props: {
  items: RadialItem[];
  open: boolean;
  label: string;
  arc: Arc | ArcToward;
  radius: number;
  itemSize: number;
  overlap?: Overlap;
  maxRadius?: number;
  // What the petals must stay inside when the arc is chosen from the room,
  // found from the menu's own element
  bounds?: (menu: HTMLElement) => Element | null | undefined;
  hints?: "always" | "hover";
  class?: string;
  center?: JSX.Element;
  onEscape?: () => void;
  // A press that opened the menu and is still held: sliding onto a petal and
  // letting go chooses it, as a press on a petal does
  pressed?: boolean;
  // The petal under a held press, or null once it slides off every petal
  onScrub?: (item: RadialItem | null) => void;
}) {
  let root: HTMLDivElement | undefined;
  const petalEls: HTMLButtonElement[] = [];

  // Opening a frame after the petals are placed lets them travel out from the centre
  const [bloomed, setBloomed] = createSignal(false);
  const [measured, setMeasured] = createSignal<Arc | null>(null);
  createEffect(() => {
    if (!props.open) {
      setBloomed(false);
      return;
    }
    setMeasured(measureArc());
    const frame = requestAnimationFrame(() => setBloomed(true));
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const measureArc = (): Arc | null => {
    const arc = props.arc;
    if ("start" in arc) return arc;
    if (!root) return null;
    const bounds = props.bounds?.(root)?.getBoundingClientRect();
    const anchor = root.getBoundingClientRect();
    return autoArc({ anchor, bounds, toward: arc.toward, maxSpan: arc.maxSpan, radius: props.radius, itemSize: props.itemSize });
  };

  const arc = (): Arc => {
    const a = props.arc;
    return measured() ?? ("start" in a ? a : { start: a.toward - a.maxSpan / 2, span: a.maxSpan });
  };
  const layout = createMemo(() => layoutPetals({
    count: props.items.length,
    arc: arc(),
    radius: props.radius,
    itemSize: props.itemSize,
    overlap: props.overlap,
    maxRadius: props.maxRadius,
  }));

  // Pressing and sliding: the petal under the pointer lights up as it would on
  // hover, and letting go on one chooses it. The click that follows a release
  // on a petal is the same choice, so it is let pass
  const [scrubbed, setScrubbed] = createSignal(-1);
  let scrubbing = false;
  let swallowClick = false;
  const petalAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest(".radial-petal");
    return el ? petalEls.indexOf(el as HTMLButtonElement) : -1;
  };
  const beginScrub = () => {
    if (scrubbing) return;
    scrubbing = true;
    let previewed = false;
    const move = (e: PointerEvent) => {
      const i = petalAt(e.clientX, e.clientY);
      if (i === scrubbed()) return;
      setScrubbed(i);
      if (i >= 0 || previewed) props.onScrub?.(i >= 0 ? props.items[i] : null);
      previewed = previewed || i >= 0;
    };
    const up = (e: PointerEvent) => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      scrubbing = false;
      const i = petalAt(e.clientX, e.clientY);
      setScrubbed(-1);
      if (i >= 0) {
        swallowClick = true;
        setTimeout(() => { swallowClick = false; }, 0);
        props.items[i].onSelect(e);
      } else if (previewed) {
        props.onScrub?.(null);
      }
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
  };
  createEffect(() => {
    if (props.open && props.pressed) beginScrub();
  });

  // One tab stop: the chosen petal, else the first; arrows move among the rest
  const [active, setActive] = createSignal(-1);
  const tabStop = () => {
    const a = active();
    if (a >= 0 && a < props.items.length) return a;
    const chosen = props.items.findIndex(item => item.selected);
    return chosen >= 0 ? chosen : 0;
  };
  const focusPetal = (index: number) => {
    const count = props.items.length;
    if (count === 0) return;
    const i = (index + count) % count;
    setActive(i);
    petalEls[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const current = petalEls.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape" && props.onEscape) {
      e.preventDefault();
      e.stopPropagation();
      props.onEscape();
      return;
    }
    if (current < 0) return;
    const moves: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (e.key in moves) focusPetal(current + moves[e.key]);
    else if (e.key === "Home") focusPetal(0);
    else if (e.key === "End") focusPetal(props.items.length - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const swatches = () => props.items.some(item => item.hue !== undefined);

  return (
    <div
      ref={root}
      class={`radial-menu ${props.class ?? ""}`}
      classList={{ "open": bloomed() && props.open, "hints-always": props.hints === "always" }}
      role={props.open ? "menu" : undefined}
      aria-label={props.open ? props.label : undefined}
      aria-hidden={!props.open}
      style={{ "--petal": `${props.itemSize}px`, "--n": props.items.length }}
      on:keydown={onKeyDown}
    >
      {props.center}
      <For each={props.items}>
        {(item, i) => {
          const petal = () => layout().petals[i()] ?? { angle: 0, x: 0, y: 0 };
          const along = (distance: number) => {
            const a = (petal().angle * Math.PI) / 180;
            return { x: Math.round(Math.cos(a) * distance * 100) / 100, y: Math.round(Math.sin(a) * distance * 100) / 100 };
          };
          const style = () => {
            const lift = along(LIFT);
            const hint = along(props.itemSize / 2 + HINT_GAP);
            return {
              "--i": i(),
              "--x": `${petal().x}px`,
              "--y": `${petal().y}px`,
              "--lx": `${petal().x + lift.x}px`,
              "--ly": `${petal().y + lift.y}px`,
              "--hx": `${hint.x}px`,
              "--hy": `${hint.y}px`,
            };
          };
          return (
            <button
              ref={(el) => { petalEls[i()] = el; }}
              type="button"
              class="radial-petal"
              classList={{
                "radial-swatch": item.hue !== undefined,
                "no-color": item.hue === null,
                "selected": !!item.selected,
                "danger": !!item.danger,
                "scrubbed": scrubbed() === i(),
              }}
              data-hue={item.hue ?? undefined}
              style={style()}
              role={swatches() ? "menuitemradio" : "menuitem"}
              aria-checked={swatches() ? !!item.selected : undefined}
              aria-label={item.label}
              title={item.label}
              tabIndex={props.open && tabStop() === i() ? 0 : -1}
              onFocus={() => setActive(i())}
              onPointerDown={(e) => { if (e.button === 0) beginScrub(); }}
              onClick={(e) => { if (!swallowClick) item.onSelect(e); }}
            >
              <Show when={item.icon}>
                <Dynamic component={item.icon} size="ui" />
              </Show>
              <Show when={item.hint}>
                <span class="action-key-hint" aria-hidden="true">{item.hint}</span>
              </Show>
            </button>
          );
        }}
      </For>
    </div>
  );
}
