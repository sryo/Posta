import { describe, expect, it } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";
import { CARD_COLORS, COLOR_HEX } from "./shared/constants";

const raw = readRepoFile("src/App.css");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);

function declaration(selector: string, prop: string, context = ""): string | undefined {
  const rule = rules.find(r => r.selectors.includes(selector) && r.context === context && r.declarations.some(([p]) => p === prop));
  return rule?.declarations.find(([p]) => p === prop)?.[1];
}

describe("postmark styles", () => {
  it("inks each card colour's stamp in that colour's solid hue", () => {
    for (const color of CARD_COLORS) {
      expect(declaration(`.card[data-color="${color}"] .postmark`, "--postmark-hue")?.toLowerCase()).toBe(COLOR_HEX[color].toLowerCase());
    }
  });

  it("pulls the hue toward the text colour, with a grey stamp on colourless cards", () => {
    expect(declaration(".postmark", "color")).toBe("var(--text-secondary)");
    const mixed = rules.find(r => r.selectors.includes(".postmark") && r.context.includes("@supports"));
    expect(mixed?.declarations.find(([p]) => p === "color")?.[1])
      .toBe("color-mix(in oklab, var(--postmark-hue, var(--text-secondary)) 70%, var(--text-primary))");
  });

  it("lands the stamp only when it is told to", () => {
    expect(declaration(".postmark", "animation")).toBeUndefined();
    expect(declaration(".postmark.lands", "animation")).toMatch(/^postmark-land 480ms /);
    expect(raw).toMatch(/@keyframes postmark-land/);
  });

  it("holds the stamp still and the query visible without motion when motion is reduced", () => {
    expect(declaration(".postmark.lands", "animation", "@media (prefers-reduced-motion: reduce)")).toBe("none");
    expect(declaration(".empty-query", "transition", "@media (prefers-reduced-motion: reduce)")).toBe("none");
  });

  it("shows the query only while the card is hovered or focused", () => {
    expect(declaration(".postmarked .empty-query", "opacity")).toBe("0");
    const shown = rules.find(r => r.selectors.includes(".card:hover .postmarked .empty-query"));
    expect(shown?.selectors).toContain(".card:focus-within .postmarked .empty-query");
    expect(shown?.declarations).toContainEqual(["opacity", "1"]);
  });
});
