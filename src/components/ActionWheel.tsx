import type { JSX } from "solid-js";
import { RadialMenu, type RadialItem } from "./RadialMenu";

// Every action wheel is the same size: icon buttons that just touch, the ring
// growing with the count
const RADIUS = 38;
const PETAL = 28;
const MAX_RADIUS = 64;

// The arc on each side of the anchor, first action at the top
const ARCS = {
  left: { start: 240, span: -120 },
  right: { start: -60, span: 120 },
} as const;

// Actions fanned out beside what they act on: a row's checkbox, a message
export function ActionWheel(props: {
  label: string;
  actions: RadialItem[];
  side: keyof typeof ARCS;
  open: boolean;
  // Key hints on every petal, as on a focused row or message; else on hover
  showHints?: boolean;
  center?: JSX.Element;
  onEscape?: () => void;
}) {
  return (
    <RadialMenu
      label={props.label}
      items={props.actions}
      open={props.open}
      arc={ARCS[props.side]}
      radius={RADIUS}
      itemSize={PETAL}
      overlap="grow"
      maxRadius={MAX_RADIUS}
      hints={props.showHints ? "always" : "hover"}
      center={props.center}
      onEscape={props.onEscape}
    />
  );
}
