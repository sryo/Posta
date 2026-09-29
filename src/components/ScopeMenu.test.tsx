import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { ScopeMenu } from "./ScopeMenu";

describe("ScopeMenu", () => {
  it("asks which events of a repeating event the action applies to", () => {
    render(() => <ScopeMenu title="Change repeating event" onChoose={vi.fn()} onCancel={vi.fn()} />);
    const menu = screen.getByRole("menu", { name: "Change repeating event" });
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map(i => i.textContent)).toEqual([
      "This event", "This and following", "All events",
    ]);
  });

  it("answers with the chosen scope", () => {
    const onChoose = vi.fn();
    render(() => <ScopeMenu title="Delete" onChoose={onChoose} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "This and following" }));
    expect(onChoose).toHaveBeenCalledWith("following");
  });

  it("starts on This event, so Enter changes the least", async () => {
    render(() => <ScopeMenu title="Delete" onChoose={vi.fn()} onCancel={vi.fn()} />);
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "This event" }));
  });

  it("moves between choices with the arrow keys", async () => {
    render(() => <ScopeMenu title="Delete" onChoose={vi.fn()} onCancel={vi.fn()} />);
    await new Promise(r => setTimeout(r, 0));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "This and following" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "All events" }));
  });

  it("cancels on Escape without letting it close what's behind", () => {
    const onCancel = vi.fn();
    const outer = vi.fn();
    render(() => <div onKeyDown={outer}><ScopeMenu title="Delete" onChoose={vi.fn()} onCancel={onCancel} /></div>);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});
