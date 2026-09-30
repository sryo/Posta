import { Show } from "solid-js";
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
// the board or window leaves room, floating over whatever is beside it.
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
}) {
  const toggle = () => props.setOpen(!props.open);
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
        onClick={(e) => { e.stopPropagation(); toggle(); }}
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
          { id: "none", label: "No color", hue: null, selected: props.value === null, onSelect: () => props.onChange(null) },
          ...props.colors.map(color => ({
            id: color.hue, label: color.label, hue: color.hue, selected: props.value === color.hue,
            onSelect: () => props.onChange(color.hue),
          })),
        ]}
        arc={{ toward: props.toward, maxSpan: MAX_SPAN }}
        bounds={(menu) => menu.closest(".deck") ?? document.body}
        radius={RADIUS}
        itemSize={PETAL}
        onEscape={() => props.setOpen(false)}
      />
    </div>
  );
}
