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
    expect(recommended.get("border-color")).toBe("var(--accent)");
  });

  it("draws a bar for cards without a colour, such as calendar cards", () => {
    expect(declarations(".preset-card.none").get("background")).toBeTruthy();
  });
});

describe("settings section toggles", () => {
  it("look like the section titles they replace rather than default buttons", () => {
    const toggle = declarations("button.settings-section-title");
    expect(toggle.get("background")).toBe("none");
    expect(toggle.get("border")).toBe("none");
    expect(toggle.get("width")).toBe("100%");
    expect(toggle.get("font-family")).toBe("inherit");
    // The shorthand would undo the title's small uppercase size
    expect(toggle.has("font")).toBe(false);
  });
});
