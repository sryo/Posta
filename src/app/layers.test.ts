import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { layerCount, pushLayer, useLayer } from "./layers";

const escape = (target: EventTarget = document, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length) removers.pop()!();
  document.body.innerHTML = "";
});

describe("layer stack", () => {
  it("closes only the layer opened last", () => {
    const first = vi.fn();
    const second = vi.fn();
    removers.push(pushLayer(first), pushLayer(second));
    escape();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("keeps the Escape from reaching the handlers behind the layer", () => {
    const behind = vi.fn();
    document.addEventListener("keydown", behind);
    try {
      removers.push(pushLayer(() => {}));
      const e = escape();
      expect(behind).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(true);
    } finally {
      document.removeEventListener("keydown", behind);
    }
  });

  it("leaves Escape in a text field to the field unless the layer asks for it", () => {
    const input = document.body.appendChild(document.createElement("input"));
    const close = vi.fn();
    removers.push(pushLayer(close));
    escape(input);
    expect(close).not.toHaveBeenCalled();

    const search = vi.fn();
    removers.push(pushLayer(search, { closesFromInputs: true }));
    escape(input);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("leaves the Escape that cancels an input method composition alone", () => {
    const close = vi.fn();
    removers.push(pushLayer(close));
    escape(document, { isComposing: true });
    expect(close).not.toHaveBeenCalled();
  });

  it("does nothing once no layer is open", () => {
    const behind = vi.fn();
    document.addEventListener("keydown", behind);
    try {
      pushLayer(() => {})();
      escape();
      expect(behind).toHaveBeenCalledTimes(1);
      expect(layerCount()).toBe(0);
    } finally {
      document.removeEventListener("keydown", behind);
    }
  });

  it("holds a layer while a condition is true and drops it with its owner", () => {
    const [open, setOpen] = createSignal(false);
    const close = vi.fn();
    const dispose = createRoot(dispose => { useLayer(open, close); return dispose; });
    expect(layerCount()).toBe(0);
    setOpen(true);
    expect(layerCount()).toBe(1);
    escape();
    expect(close).toHaveBeenCalledTimes(1);
    setOpen(false);
    expect(layerCount()).toBe(0);
    setOpen(true);
    dispose();
    expect(layerCount()).toBe(0);
  });
});
