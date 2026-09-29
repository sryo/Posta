import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { askScope, ScopePrompt } from "./scopePrompt";

afterEach(cleanup);

describe("askScope", () => {
  it("answers with the scope chosen", async () => {
    render(() => <ScopePrompt />);
    const answer = askScope("Delete repeating event", { left: 100, bottom: 200 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "This and following" }));
    expect(await answer).toBe("following");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("answers null when dismissed or asked again", async () => {
    render(() => <ScopePrompt />);
    const first = askScope("First");
    const second = askScope("Second");
    expect(await first).toBeNull();
    expect(screen.getByRole("menu", { name: "Second" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await second).toBeNull();
  });

  it("keeps the menu inside the window", async () => {
    render(() => <ScopePrompt />);
    const answer = askScope("Delete repeating event", { left: window.innerWidth - 20, bottom: window.innerHeight - 10 });
    const prompt = (await screen.findByRole("menu")).parentElement!;
    expect(parseFloat(prompt.style.left)).toBeLessThanOrEqual(window.innerWidth - 216);
    expect(parseFloat(prompt.style.top)).toBeLessThanOrEqual(window.innerHeight - 180);
    fireEvent.keyDown(document, { key: "Escape" });
    await answer;
  });
});
