import { describe, expect, it } from "vitest";
import { parseRules } from "./css";
import { readRepoFile } from "./files";

const rules = parseRules(readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, ""));
const declarations = (selector: string) =>
  new Map(rules.filter(r => !r.context && r.selectors.includes(selector)).flatMap(r => r.declarations));

const inContext = (selector: string, context: string) =>
  new Map(rules.filter(r => r.context === context && r.selectors.includes(selector)).flatMap(r => r.declarations));
const ruleWith = (selector: string) => rules.find(r => !r.context && r.selectors.includes(selector));

describe("preset picker styles", () => {
  it("sets each preset's name, badge and description at the start of its row, over its frame", () => {
    expect(declarations(".preset-option").get("text-align")).toBe("start");
    expect(declarations(".preset-option").get("align-items")).toBe("flex-start");
  });

  it("keeps the recommended preset's border as wide as the others", () => {
    const recommended = declarations(".preset-option.recommended");
    expect(recommended.has("border")).toBe(false);
    expect(recommended.get("border-color")).toBe("var(--border-focus)");
  });

  it("scrolls the picker rather than spilling past a short window", () => {
    expect(declarations(".preset-modal").get("max-height")).toMatch(/^calc\(100vh - /);
    expect(declarations(".preset-modal").get("overflow-y")).toBe("auto");
  });
});

describe("sorting frame styles", () => {
  it("gives every slot the same width, so a rack's length counts its cards, and stacks a second tier when it runs out of room", () => {
    expect(declarations(".sorting-slot").get("flex")).toBe("0 0 var(--slot-width)");
    expect(declarations(".sorting-frame").get("flex-wrap")).toBe("wrap");
  });

  it("derives each slot's ink from its card colour, and plain ink for a slot without one", () => {
    const derived = rules.find(r => !r.context && r.declarations.some(([p]) => p === "--card-ink-text") && r.selectors.includes(".card[data-color]"));
    expect(derived?.selectors).toContain(".sorting-slot[data-hue]");
    expect(declarations(".sorting-slot").get("--card-ink-text")).toBe("var(--text-primary)");
  });

  it("inks a frame's labels in their colours while its preset is pointed at or focused, or its slot is lit", () => {
    const lit = ruleWith(".sorting-slot.lit .sorting-label");
    expect(lit?.selectors).toEqual(expect.arrayContaining([".preset-option:hover .sorting-label", ".preset-option:focus-visible .sorting-label"]));
    expect(lit?.declarations).toContainEqual(["color", "var(--card-ink-text)"]);
    expect(declarations(".sorting-label").get("color")).toBe("var(--text-secondary)");
  });

  it("inks the empty board's colourless slots in the board's accent", () => {
    expect(declarations(".empty-board .sorting-slot").get("--card-ink-text")).toBe("var(--text-link)");
  });

  it("keeps the letters out of sight until their slot is filled, then drops them in", () => {
    expect(declarations(".sorting-letter").get("opacity")).toBe("0");
    const filled = declarations(".sorting-slot.filled .sorting-letter");
    expect(Number(filled.get("opacity"))).toBeGreaterThan(0);
    expect(filled.get("transition")).toMatch(/transform 240ms /);
  });

  it("sets the letters in without moving them when motion is reduced", () => {
    expect(inContext(".sorting-slot.filled .sorting-letter", "@media (prefers-reduced-motion: reduce)").get("transition")).toBe("none");
  });
});

describe("client file chooser", () => {
  it("shows keyboard focus on its label, since the file input itself is hidden", () => {
    const focused = declarations(".credentials-drop-zone label:has(:focus-visible)");
    expect(focused.get("outline")).toBe("2px solid var(--border-focus)");
  });
});
