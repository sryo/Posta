import type { JSX } from "solid-js";
import { RadialMenu, type RadialItem } from "./RadialMenu";

// Every action wheel is the same size: icon buttons that just touch, the ring
// growing with the count
const RADIUS = 38;
const PETAL = 28;
const MAX_RADIUS = 64;

// The fan on each side of the anchor, first action at the top. Where the
// scrolling area it sits in would cut it off, as on a card's first row, the
// fan turns away from that edge
// Never narrower than MIN_SPAN: the ring then grows until the petals clear
// each other, so every action stays in sight
const MIN_SPAN = 90;
const ARCS = {
  left: { toward: 180, maxSpan: 120, minSpan: MIN_SPAN, reverse: true },
  right: { toward: 0, maxSpan: 120, minSpan: MIN_SPAN },
} as const;

const scrollArea = (menu: HTMLElement) => menu.closest(".card-body, .thread-overlay") ?? document.body;

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
      bounds={scrollArea}
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
