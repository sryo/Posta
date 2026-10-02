import { describe, expect, it } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";
import { CARD_COLORS } from "./shared/constants";

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
      const rule = rules.find(r => !r.context && r.selectors.includes(`.card[data-color="${color}"]`) && r.declarations.some(([p]) => p === "--card-hue"));
      expect(rule?.declarations.find(([p]) => p === "--card-hue")?.[1], color).toBe(`var(--hue-${color})`);
    }
  });

  it("pulls the hue toward the text colour, with a grey stamp on colourless cards", () => {
    expect(declaration(".postmark", "color")).toBe("var(--card-ink)");
    expect(declaration(":root", "--card-ink")).toBe("var(--text-secondary)");
    expect(declaration(".card[data-color]", "--card-ink")).toBe("color-mix(in oklab, var(--card-hue) 70%, var(--text-primary))");
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

describe("long in transit", () => {
  it("joins the two cards through the stamp, taking back the list's gap on either side", () => {
    expect(declaration(".messages-list", "gap")).toBe("var(--space-2xl)");
    expect(declaration(".transit", "margin")).toBe("calc(-1 * var(--space-2xl)) 0");
    expect(declaration(".transit-line", "border-left")).toMatch(/^1\.5px dashed color-mix\(in srgb, var\(--card-ink\) \d+%, transparent\)$/);
  });

  it("inks the stamp in the thread's card colour, or the default ink", () => {
    const derived = rules.find(r => r.selectors.includes(".transit[data-hue]") && r.declarations.some(([p]) => p === "--card-ink"));
    expect(derived?.selectors).toContain(".thread-bar-card[data-hue]");
  });

  it("keeps the stamp straighter and fainter than an emptied card's postmark", () => {
    expect(declaration(".postmark.transit-stamp", "--tilt")).toBe("-3deg");
    expect(declaration(".postmark.transit-stamp", "width")).toBe("150px");
    expect(declaration(".postmark.transit-stamp", "height")).toBe("64px");
    const faint = (ctx = "") => Number(declaration(".postmark.transit-stamp", "opacity", ctx));
    const postmark = (ctx = "") => Number(declaration(".postmark", "opacity", ctx));
    expect(faint()).toBeLessThan(postmark());
    const dark = "@media (prefers-color-scheme: dark)";
    expect(faint(dark)).toBeLessThan(postmark(dark));
    expect(faint(dark)).toBeGreaterThan(faint());
  });

  it("sets the last-letter line in a reply as quiet meta text", () => {
    expect(declaration(".compose-last-letter", "font")).toBe("var(--type-meta)");
    expect(declaration(".compose-last-letter", "color")).toBe("var(--text-muted)");
  });
});
