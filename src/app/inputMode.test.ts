import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent } from "@solidjs/testing-library";
import { inputMode, setInputMode } from "./inputMode";

const mode = () => document.documentElement.dataset.input;

describe("input mode", () => {
  beforeEach(() => setInputMode("pointer"));

  it("starts with the pointer and marks the page with it", () => {
    expect(inputMode()).toBe("pointer");
    expect(mode()).toBe("pointer");
  });

  it("turns to the keyboard on a key, and back to the pointer when the mouse moves or presses", () => {
    fireEvent.keyDown(document, { key: "j" });
    expect(inputMode()).toBe("keyboard");
    expect(mode()).toBe("keyboard");
    fireEvent.pointerMove(document, { screenX: 10, screenY: 10 });
    expect(inputMode()).toBe("pointer");

    fireEvent.keyDown(document, { key: "j" });
    fireEvent.pointerDown(document, { screenX: 10, screenY: 10 });
    expect(inputMode()).toBe("pointer");
  });

  it("stays with the keyboard on the move WebKit sends when the list scrolls under a still mouse", () => {
    fireEvent.pointerMove(document, { screenX: 50, screenY: 50 });
    fireEvent.keyDown(document, { key: "j" });
    fireEvent.pointerMove(document, { screenX: 50, screenY: 50 });
    expect(inputMode()).toBe("keyboard");
  });

  it("ignores a modifier pressed alone, and what's typed into a field, but not Tab out of one", () => {
    fireEvent.keyDown(document, { key: "Shift" });
    fireEvent.keyDown(document, { key: "Meta" });
    expect(inputMode()).toBe("pointer");

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "a" });
    expect(inputMode()).toBe("pointer");
    fireEvent.keyDown(input, { key: "Tab" });
    expect(inputMode()).toBe("keyboard");
    input.remove();
  });
});
