import { createUniqueId, type JSX } from "solid-js";
import { Dialog } from "./Dialog";
import { PanelHeader } from "./FormParts";

// A modal sheet over a scrim, titled beside its close button:
//   side    a drawer sliding in from the right, for a list to pick from
//   center  a card in the middle, for reference such as help
// Escape, the scrim and ✕ all close it; Tab stays inside while it is open.
// Its width comes from `class` setting --sheet-width.
export function Sheet(props: {
  title: string;
  placement: "side" | "center";
  class: string;
  onClose: () => void;
  initialFocus?: (sheet: HTMLElement) => HTMLElement | null | undefined;
  closesFromInputs?: boolean;
  children: JSX.Element;
}) {
  const titleId = createUniqueId();
  return (
    <>
      <div class="sheet-scrim" data-placement={props.placement} onClick={() => props.onClose()}></div>
      <Dialog
        class={`sheet ${props.class}`}
        data-placement={props.placement}
        labelledBy={titleId}
        onClose={() => props.onClose()}
        initialFocus={props.initialFocus}
        closesFromInputs={props.closesFromInputs}
      >
        <PanelHeader size="sheet" onClose={() => props.onClose()}>
          <h2 id={titleId} class="sheet-title">{props.title}</h2>
        </PanelHeader>
        {props.children}
      </Dialog>
    </>
  );
}
