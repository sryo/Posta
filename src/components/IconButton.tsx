import type { JSX } from "solid-js";

// A button that is only an icon: named for assistive tech by `label`, with a
// hover wash. md is 32px, a card header's or panel's tool; sm is 26px, beside
// a line of text. On a dark toast it takes the inverse tone.
export function IconButton(props: {
  label: string;
  title?: string;
  size?: "sm" | "md";
  tone?: "default" | "inverse";
  class?: string;
  disabled?: boolean;
  onClick: (e: MouseEvent) => void;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      class={`icon-btn${props.class ? ` ${props.class}` : ""}`}
      data-size={props.size === "sm" ? "sm" : undefined}
      data-tone={props.tone === "inverse" ? "inverse" : undefined}
      aria-label={props.label}
      title={props.title ?? props.label}
      disabled={props.disabled}
      onClick={(e) => props.onClick(e)}
    >
      {props.children}
    </button>
  );
}
