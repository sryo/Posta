import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@solidjs/testing-library";
import { createToasts } from "../app/toasts";
import { Toasts } from "./Toasts";

function setup() {
  let toasts!: ReturnType<typeof createToasts>;
  const result = render(() => {
    toasts = createToasts();
    return <Toasts toasts={toasts} />;
  });
  const polite = result.container.querySelector('[aria-live="polite"]') as HTMLElement;
  const assertive = result.container.querySelector('[aria-live="assertive"]') as HTMLElement;
  return { ...result, toasts, polite, assertive };
}

describe("Toasts", () => {
  it("keeps its live regions in the page with nothing to say, so the first toast is announced", () => {
    const { polite, assertive } = setup();
    expect(polite).toBeInTheDocument();
    expect(polite).toHaveAttribute("role", "status");
    expect(assertive).toBeInTheDocument();
    expect(polite.textContent).toBe("");
    expect(polite.querySelector(".undo-toast")).toBeNull();
  });

  it("announces information politely and errors assertively", () => {
    const { toasts, polite, assertive } = setup();
    toasts.show({ message: "Reply sent" });
    expect(polite).toHaveTextContent("Reply sent");
    toasts.show({ message: "Couldn't send the reply.", tone: "error" });
    expect(assertive).toHaveTextContent("Couldn't send the reply.");
    expect(polite).toHaveTextContent("Reply sent");
  });

  it("raises an error over the toast already showing instead of making it wait", () => {
    const { toasts, polite, assertive } = setup();
    const undo = vi.fn();
    toasts.show({ message: "Archived 1 thread", undo });
    toasts.show({ message: "Couldn't star 1 thread.", tone: "error" });
    expect(polite).toHaveTextContent("Archived 1 thread");
    expect(assertive.querySelector(".undo-toast")).toHaveClass("raised");
    fireEvent.click(within(assertive).getByTitle("Dismiss"));
    expect(toasts.error()?.closing).toBe(true);
    expect(toasts.current()?.closing).toBe(false);
    fireEvent.click(within(polite).getByRole("button", { name: /Undo/ }));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("raises an error over the send toast, which the store doesn't hold", () => {
    let toasts!: ReturnType<typeof createToasts>;
    const result = render(() => {
      toasts = createToasts();
      return (
        <Toasts toasts={toasts} othersShowing>
          <div class="undo-toast send-toast">Sending…</div>
        </Toasts>
      );
    });
    toasts.show({ message: "Couldn't star 1 thread.", tone: "error" });
    const assertive = result.container.querySelector('[aria-live="assertive"]') as HTMLElement;
    expect(assertive.querySelector(".undo-toast")).toHaveClass("raised");
  });

  it("leaves an error where toasts show when nothing else is showing", () => {
    const { toasts, assertive } = setup();
    toasts.show({ message: "Couldn't star 1 thread.", tone: "error" });
    expect(assertive.querySelector(".undo-toast")).not.toHaveClass("raised");
  });

  it("offers every action a toast carries", () => {
    const { toasts, polite } = setup();
    const discard = vi.fn();
    toasts.show({ message: "Draft saved", action: [{ label: "Open", run: () => {} }, { label: "Discard", run: discard }] });
    expect(within(polite).getByRole("button", { name: "Open" })).toBeInTheDocument();
    fireEvent.click(within(polite).getByRole("button", { name: "Discard" }));
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it("stops its timer while the pointer or keyboard focus is on it", () => {
    const { toasts, polite } = setup();
    toasts.show({ message: "Reply sent", action: { label: "Open", run: () => {} } });
    const toast = polite.querySelector(".undo-toast")!;
    fireEvent.mouseEnter(toast);
    expect(toasts.current()?.paused).toBe(true);
    expect(toast).toHaveClass("paused");
    fireEvent.mouseLeave(toast);
    expect(toasts.current()?.paused).toBe(false);
    fireEvent.focusIn(within(polite).getByRole("button", { name: "Open" }));
    expect(toasts.current()?.paused).toBe(true);
    fireEvent.focusOut(within(polite).getByRole("button", { name: "Open" }), { relatedTarget: within(polite).getByTitle("Dismiss") });
    expect(toasts.current()?.paused).toBe(true);
    fireEvent.focusOut(within(polite).getByRole("button", { name: "Open" }));
    expect(toasts.current()?.paused).toBe(false);
  });

  it("stays paused when the pointer leaves while keyboard focus is still on it", () => {
    const { toasts, polite } = setup();
    toasts.show({ message: "Reply sent", action: { label: "Open", run: () => {} } });
    const toast = polite.querySelector(".undo-toast")!;
    const open = within(polite).getByRole("button", { name: "Open" });
    open.focus();
    fireEvent.focusIn(open);
    fireEvent.mouseEnter(toast);
    fireEvent.mouseLeave(toast);
    expect(toasts.current()?.paused).toBe(true);
  });

  it("undoes from its Undo button, which shows the z shortcut", () => {
    const { toasts, polite } = setup();
    const undo = vi.fn();
    toasts.show({ message: "Archived 1 thread", undo });
    const button = within(polite).getByRole("button", { name: /Undo/ });
    expect(button).toHaveTextContent("z");
    fireEvent.click(button);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("offers Retry on an error that can be tried again", () => {
    const { toasts, assertive } = setup();
    const retry = vi.fn();
    toasts.show({ message: "Couldn't archive 1 thread.", tone: "error", action: { label: "Retry", run: retry } });
    fireEvent.click(within(assertive).getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("keeps the progress fill, running as long as the toast shows and none for one that stays", () => {
    const { toasts, polite, assertive } = setup();
    toasts.show({ message: "Reply sent" });
    expect(polite.querySelector(".toast-progress")).toHaveStyle({ "animation-duration": "5000ms" });
    toasts.show({ message: "Couldn't load labels.", tone: "error" });
    expect(assertive.querySelector(".toast-progress")).toBeNull();
  });

  it("dismisses from its close button", () => {
    const { toasts, polite } = setup();
    toasts.show({ message: "Reply sent" });
    fireEvent.click(within(polite).getByTitle("Dismiss"));
    expect(toasts.current()?.closing).toBe(true);
  });
});
