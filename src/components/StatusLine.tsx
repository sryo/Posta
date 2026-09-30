import type { JSX } from "solid-js";

// What a list or panel says instead of content: that it is loading, has
// nothing, or failed. Errors are announced as alerts, the rest politely.
//   line   a list's own line, centred, in the meta size (a card, a drawer)
//   block  a whole panel's message, roomier (batch reply)
//   inline beside other controls, left-aligned (smart replies)
export function StatusLine(props: {
  kind: "loading" | "empty" | "error";
  size?: "line" | "block" | "inline";
  class?: string;
  title?: string;
  children: JSX.Element;
}) {
  return (
    <div
      class={`status-line${props.class ? ` ${props.class}` : ""}`}
      data-kind={props.kind}
      data-size={props.size ?? "line"}
      role={props.kind === "error" ? "alert" : "status"}
      title={props.title}
    >
      {props.children}
    </div>
  );
}
