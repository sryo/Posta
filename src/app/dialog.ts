import { onCleanup, onMount } from "solid-js";
import { pushLayer } from "./layers";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open dialogs; the board stays inert until the last one closes
let openDialogs = 0;

function setBoardInert(inert: boolean) {
  for (const el of document.querySelectorAll("[data-board]")) {
    if (inert) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }
}

function focusables(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.closest("[inert]"));
}

export interface DialogOptions {
  onClose: () => void;
  // Id of the element naming the dialog
  labelledBy?: string;
  // What takes focus on opening; the first focusable element, else the dialog
  initialFocus?: (dialog: HTMLElement) => HTMLElement | null | undefined;
  // Escape in the dialog's text fields closes it too
  closesFromInputs?: boolean;
}

// Makes the element given to the returned ref a modal dialog: named, focused
// on opening, keeping Tab inside, closing on Escape (as the top layer), with
// the board behind it inert, and giving focus back to what had it on closing.
// Call it in the component that renders the dialog, before any layer the
// dialog holds open over itself.
export function useDialog(options: DialogOptions): (el: HTMLElement) => void {
  let dialog: HTMLElement | undefined;
  const returnTo = document.activeElement;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !dialog) return;
    const items = focusables(dialog);
    if (items.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  onMount(() => {
    if (!dialog) return;
    openDialogs++;
    setBoardInert(true);
    const removeLayer = pushLayer(() => options.onClose(), { closesFromInputs: options.closesFromInputs });
    dialog.addEventListener("keydown", onKeyDown);
    const target = options.initialFocus?.(dialog) ?? focusables(dialog)[0] ?? dialog;
    // An autofocus field may already hold focus inside the dialog
    if (!dialog.contains(document.activeElement)) target.focus({ preventScroll: true });

    onCleanup(() => {
      removeLayer();
      dialog?.removeEventListener("keydown", onKeyDown);
      openDialogs--;
      if (openDialogs === 0) setBoardInert(false);
      const active = document.activeElement;
      const focusLeavesWithDialog = !active || active === document.body || !active.isConnected || !!dialog?.contains(active);
      if (focusLeavesWithDialog && returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus({ preventScroll: true });
    });
  });

  return (el: HTMLElement) => {
    dialog = el;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    if (options.labelledBy) el.setAttribute("aria-labelledby", options.labelledBy);
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  };
}
