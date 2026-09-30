import { Show, createSignal, onCleanup } from "solid-js";
import { PaletteIcon } from "./Icons";
import { RadialMenu } from "./RadialMenu";
import { onActivateKey } from "../shared/keyboard";

export type FlowerColor = { hue: string; label: string };

// Every colour flower is the same size; only the way it opens differs
const RADIUS = 34;
const PETAL = 20;
const MAX_SPAN = 240;

// A colour choice: the current colour as a swatch that blooms into a petal per
// colour, "no colour" first. The flower fans toward `toward` as far round as
// the board or window leaves room, floating over whatever is beside it. Press
// and slide across the petals to try each colour; let go on one to keep it.
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
  // Shows a colour while a held press slides over its petal, and the colour
  // it started from when the press slides off or is let go of elsewhere
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

  let before: string | null = null;
  let previewing = false;
  const preview = (hue: string | null | undefined) => {
    if (!props.onPreview) return;
    if (hue === undefined) {
      if (previewing) props.onPreview(before);
      previewing = false;
      return;
    }
    if (!previewing) before = props.value;
    previewing = true;
    props.onPreview(hue);
  };
  const choose = (hue: string | null) => {
    previewing = false;
    props.onChange(hue);
  };
  return (
    <div class="color-picker" classList={{ "compact": !!props.compact }}>
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
        items={[
          { id: "none", label: "No color", hue: null, selected: props.value === null, onSelect: () => choose(null) },
          ...props.colors.map(color => ({
            id: color.hue, label: color.label, hue: color.hue, selected: props.value === color.hue,
            onSelect: () => choose(color.hue),
          })),
        ]}
        arc={{ toward: props.toward, maxSpan: MAX_SPAN }}
        bounds={(menu) => menu.closest(".deck") ?? document.body}
        radius={RADIUS}
        itemSize={PETAL}
        onEscape={() => { preview(undefined); props.setOpen(false); }}
        pressed={pressed()}
        onScrub={(item) => preview(item ? item.hue ?? null : undefined)}
      />
    </div>
  );
}
