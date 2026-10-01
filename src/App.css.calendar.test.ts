import { describe, expect, it } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";

const css = readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);

function declaration(selector: string, prop: string, context = ""): string | undefined {
  const rule = rules.find(r => r.selectors.includes(selector) && r.context === context && r.declarations.some(([p]) => p === prop));
  return rule?.declarations.find(([p]) => p === prop)?.[1];
}

describe("everyone else declined", () => {
  it("says it muted, in the place line's type", () => {
    expect(declaration(".calendar-event-alone", "font")).toBe("var(--type-meta)");
    expect(declaration(".calendar-event-alone", "color")).toBe("var(--text-muted)");
    expect(declaration(".calendar-event-alone", "display")).toBe("flex");
  });

  it("sets the organizer's actions as quiet text buttons, cancelling in the danger ink", () => {
    expect(declaration(".calendar-event-alone-action", "background")).toBe("none");
    expect(declaration(".calendar-event-alone-action", "border")).toBe("none");
    expect(declaration(".calendar-event-alone-action", "font")).toBe("var(--type-meta)");
    expect(declaration(".calendar-event-alone-action", "color")).toBe("var(--text-link)");
    expect(declaration(".calendar-event-alone-action.danger", "color")).toBe("var(--danger-text)");
  });
});

describe("moving an event", () => {
  it("says on the target, in the free or warning ink, whether the time is free", () => {
    expect(declaration(".move-verdict", "font")).toBe("var(--type-meta)");
    expect(declaration(".move-verdict", "text-transform")).toBe("none");
    expect(declaration(".move-verdict", "color")).toBe("var(--success-text)");
    expect(declaration(".move-verdict.clash", "color")).toBe("var(--warning-text)");
  });

  it("lifts the target held over, and fades the row being moved", () => {
    expect(declaration(".move-over", "background")).toMatch(/^color-mix\(in srgb, var\(--card-ink\) \d+%, transparent\)$/);
    expect(Number(declaration(".calendar-event-item.drag-source", "opacity"))).toBeLessThan(0.5);
  });

  it("carries a ghost under the pointer that never catches it", () => {
    expect(declaration(".event-drag-ghost", "position")).toBe("fixed");
    expect(declaration(".event-drag-ghost", "pointer-events")).toBe("none");
    expect(declaration(".event-drag-ghost", "z-index")).toBe("var(--z-toast)");
    expect(declaration(".event-drag-ghost", "box-shadow")).toBe("var(--shadow-md)");
  });

  it("holds the grabbing cursor and keeps text unselected while dragging", () => {
    expect(declaration("body.dragging-event", "cursor")).toBe("grabbing");
    expect(declaration("body.dragging-event", "user-select")).toBe("none");
  });
});
