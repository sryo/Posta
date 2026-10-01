import { describe, expect, it } from "vitest";
import { parseRules } from "./css";
import { readRepoFile } from "./files";

const rules = parseRules(readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, ""));
const declarations = (selector: string) =>
  new Map(rules.filter(r => !r.context && r.selectors.includes(selector)).flatMap(r => r.declarations));

describe("preset picker styles", () => {
  it("centres every preset's label, badge or not, like the text under it", () => {
    expect(declarations(".preset-label").get("justify-content")).toBe("center");
    expect(declarations(".preset-option").get("text-align")).toBe("center");
  });

  it("keeps the recommended preset's border as wide as the others", () => {
    const recommended = declarations(".preset-option.recommended");
    expect(recommended.has("border")).toBe(false);
    expect(recommended.get("border-color")).toBe("var(--border-focus)");
  });

  it("draws a bar for cards without a colour, such as calendar cards", () => {
    expect(declarations(".preset-card.none").get("background")).toBeTruthy();
  });

  it("narrows the bars to fit a preview with many cards instead of spilling out of the tile", () => {
    const bar = declarations(".preset-card");
    expect(bar.get("flex-shrink")).not.toBe("0");
    expect(bar.get("min-width")).toBe("0");
    expect(declarations(".preset-preview").get("min-width")).toBe("0");
  });
});

describe("client file chooser", () => {
  it("shows keyboard focus on its label, since the file input itself is hidden", () => {
    const focused = declarations(".credentials-drop-zone label:has(:focus-visible)");
    expect(focused.get("outline")).toBe("2px solid var(--border-focus)");
  });
});
