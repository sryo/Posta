import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { NoticeLine } from "./NoticeLine";

describe("NoticeLine", () => {
  it("states the fact politely, with its action and a ×", () => {
    const run = vi.fn();
    const dismiss = vi.fn();
    render(() => <NoticeLine text="You were Bcc'd." action={{ label: "Reply to Jules only", run }} onDismiss={dismiss} />);
    const line = screen.getByRole("status");
    expect(line).toHaveTextContent("You were Bcc'd.");
    fireEvent.click(screen.getByRole("button", { name: "Reply to Jules only" }));
    expect(run).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(dismiss).toHaveBeenCalled();
  });

  it("can be the fact alone", () => {
    render(() => <NoticeLine text="Added 2" />);
    expect(screen.getByRole("status")).toHaveTextContent("Added 2");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
