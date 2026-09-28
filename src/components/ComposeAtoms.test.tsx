import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@solidjs/testing-library";
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
