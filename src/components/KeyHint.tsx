import type { JSX } from "solid-js";

// A keyboard shortcut shown beside what it does, in one of three looks:
//   inline: faint small caps inside a button or after a label ("Save ⌘↵")
//   pill:   a small dark pill, as beside a wheel's petal
//   key:    a keycap, as in the shortcuts sheet
// Hidden from assistive tech: the control it sits on names its key itself
export function KeyHint(props: {
  keys: JSX.Element;
  look?: "inline" | "pill" | "key";
  class?: string;
  title?: string;
}) {
  const look = () => props.look ?? "inline";
  return (
    <kbd
      class={`key-hint${look() === "inline" ? "" : ` ${look()}`}${props.class ? ` ${props.class}` : ""}`}
      title={props.title}
      aria-hidden="true"
    >
      {props.keys}
    </kbd>
  );
}
