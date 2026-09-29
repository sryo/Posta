import type { JSX } from "solid-js";
import { useDialog, type DialogOptions } from "../app/dialog";

// A sheet or drawer that is a modal dialog while shown (see useDialog)
export function Dialog(props: DialogOptions & { class: string; children: JSX.Element }) {
  const ref = useDialog({
    onClose: () => props.onClose(),
    labelledBy: props.labelledBy,
    initialFocus: props.initialFocus,
    closesFromInputs: props.closesFromInputs,
  });
  return <div class={props.class} ref={ref}>{props.children}</div>;
}
