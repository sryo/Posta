import { describe, expect, it } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";

const raw = readRepoFile("src/App.css");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);

function declaration(selector: string, prop: string, context = ""): string | undefined {
  const rule = rules.find(r => r.selectors.includes(selector) && r.context === context && r.declarations.some(([p]) => p === prop));
  return rule?.declarations.find(([p]) => p === prop)?.[1];
}

const SETTLE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

describe("the focus ring", () => {
  it("floats over the rows without taking the pointer, under the wheels' petals", () => {
    expect(declaration(".focus-ring", "position")).toBe("fixed");
    expect(declaration(".focus-ring", "pointer-events")).toBe("none");
    const radial = Number(declaration(".radial-menu", "z-index"));
    expect(Number(declaration(".focus-ring", "z-index"))).toBeLessThan(radial);
  });

  it("is drawn in the focus colour, which is the card's ring on a coloured card", () => {
    expect(declaration(".focus-ring", "box-shadow")).toBe("inset 0 0 0 2px color-mix(in srgb, var(--border-focus) 75%, transparent)");
    expect(declaration(".focus-ring[data-hue]", "--border-focus")).toBe("var(--card-ring)");
    expect(declaration(".focus-ring[data-hue]", "--card-ring")).toBe("color-mix(in srgb, var(--card-hue) var(--card-ring-mix), transparent)");
  });

  it("glides in 180ms on the settling curve, and jumps when told to", () => {
    const transition = declaration(".focus-ring", "transition") ?? "";
    for (const prop of ["transform", "width", "height"]) expect(transition).toContain(`${prop} 180ms ${SETTLE}`);
    expect(declaration(".focus-ring.instant", "transition")).toBe("none");
  });

  it("nudges 3px toward the edge it was pressed against", () => {
    expect(declaration('.focus-ring[data-bump="down"]', "animation")).toMatch(/^focus-bump-down 220ms /);
    expect(declaration('.focus-ring[data-bump="up"]', "animation")).toMatch(/^focus-bump-up 220ms /);
    expect(declaration('.focus-ring[data-bump="side"]', "animation")).toMatch(/^focus-bump-side 220ms /);
    expect(raw).toMatch(/@keyframes focus-bump-down \{\s*40% \{ translate: 0 3px; \}/);
  });

  it("stands in for the focused row's own outline while working from the keyboard", () => {
    expect(declaration(':root[data-input="keyboard"] .thread.focused', "outline")).toBe("none");
    expect(declaration(':root[data-input="keyboard"] .calendar-event-item.focused', "outline")).toBe("none");
  });
});

describe("the line at the focus's edge", () => {
  it("is quiet: small muted text under the card's rows, above a divider", () => {
    expect(declaration(".focus-edge", "font")).toBe("var(--type-meta)");
    expect(declaration(".focus-edge", "color")).toBe("var(--text-muted)");
    expect(declaration(".focus-edge", "border-top")).toBe("1px solid var(--card-divider)");
  });
});

