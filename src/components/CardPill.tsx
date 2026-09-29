import type { JSX } from "solid-js";

// The card a thread or event view was opened from, named in its bar. A
// coloured card's pill wears its hue: the stylesheet derives the tint and a
// label ink that reads on it from data-hue.
export const CardPill = (props: { color: string | null | undefined; children: JSX.Element }) => (
  <div class={props.color ? "thread-bar-card tinted" : "thread-bar-card"} data-hue={props.color || undefined}>
    {props.children}
  </div>
);
