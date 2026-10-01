import { describe, expect, it } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";
import { contrast, over, resolveColor, tokenScope, type Theme } from "./test/color";
import { CARD_COLORS } from "./shared/constants";

const css = readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);
const THEMES: Theme[] = ["light", "dark"];

function declaration(selector: string, prop: string, context = ""): string | undefined {
  const rule = rules.find(r => r.selectors.includes(selector) && r.context === context && r.declarations.some(([p]) => p === prop));
  return rule?.declarations.find(([p]) => p === prop)?.[1];
}

// The selector's colour stays readable on every card's tint
function readableOnCards(selector: string) {
  for (const theme of THEMES) {
    it(`keeps ${selector} at 4.5:1 on every card colour in ${theme} mode`, () => {
      for (const hue of CARD_COLORS) {
        const scope = tokenScope(rules, theme, [".card[data-color]", `.card[data-color="${hue}"]`]);
        const token = (value: string) => resolveColor(value.startsWith("var(") ? value : `var(${value})`, scope);
        const bg = over(token("--card-tint"), token("--surface-app"));
        expect(contrast(token(declaration(selector, "color")!), bg), hue).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
}

describe("a thread's aside", () => {
  it("is one line of meta type in muted ink, cut short rather than wrapped", () => {
    expect(declaration(".thread-aside", "font")).toBe("var(--type-meta)");
    expect(declaration(".thread-aside", "color")).toBe("var(--text-muted)");
    expect(declaration(".thread-aside", "white-space")).toBe("nowrap");
    expect(declaration(".thread-aside", "text-overflow")).toBe("ellipsis");
  });

  readableOnCards(".thread-aside");
});
