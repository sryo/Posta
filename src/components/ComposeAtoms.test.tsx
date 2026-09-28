import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { ComposeTextarea } from "./ComposeAtoms";

const renderTextarea = () =>
  render(() => (
    <ComposeTextarea value="" onChange={vi.fn()} onSend={vi.fn()} onCancel={vi.fn()} autofocus class="quick-reply-input" />
  ));

describe("ComposeTextarea autofocus", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("focuses the textarea shortly after it mounts", () => {
    vi.useFakeTimers();
    const { container } = renderTextarea();
    vi.advanceTimersByTime(100);
    expect(document.activeElement).toBe(container.querySelector("textarea"));
  });

  it("does not try to focus a textarea that unmounted before the delay ran", () => {
    vi.useFakeTimers();
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus");
    const { unmount } = renderTextarea();
    unmount();
    vi.advanceTimersByTime(100);
    expect(focus).not.toHaveBeenCalled();
  });
});

describe("ComposeTextarea while an input method is composing", () => {
  it("keeps the quick reply open on the Escape that cancels a composition", () => {
    const onCancel = vi.fn();
    const onSend = vi.fn();
    const { container } = render(() => (
      <ComposeTextarea value="hola" onChange={vi.fn()} onSend={onSend} onCancel={onCancel} class="quick-reply-input" />
    ));
    const textarea = container.querySelector("textarea")!;
    fireEvent.keyDown(textarea, { key: "Escape", isComposing: true });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true, isComposing: true });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
