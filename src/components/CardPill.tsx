import type { JSX } from "solid-js";
import { COLOR_HEX } from "../shared/constants";

// The card a thread or event view was opened from, named in its bar
export const CardPill = (props: { color: string | null | undefined; children: JSX.Element }) => {
  const hex = () => (props.color ? COLOR_HEX[props.color] : undefined);
  return (
    <div
      class={hex() ? "thread-bar-card tinted" : "thread-bar-card"}
      style={hex() ? { "--pill-color": hex() } : undefined}
    >
      {props.children}
    </div>
  );
};
