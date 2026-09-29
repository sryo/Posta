import { describe, it, expect } from "vitest";
import { parseRules } from "../test/css";
import { readRepoFile } from "../test/files";

const rules = parseRules(readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, ""));

function declarations(selector: string): Map<string, string> {
  return new Map(rules.filter(rule => rule.selectors.includes(selector) && !rule.context).flatMap(rule => rule.declarations));
}

describe("compose styles", () => {
  it("anchors recipient suggestions under whichever recipient field shows them", () => {
    expect(declarations(".compose-autocomplete").get("position")).toBe("absolute");
    expect(declarations(".compose-field").get("position")).toBe("relative");
  });

  it("keeps a draft row's Discard button a quiet control that turns to danger on hover or focus", () => {
    const button = declarations(".thread-draft-discard");
    expect(button.get("color")).toBe("var(--text-muted)");
    expect(button.get("flex-shrink")).toBe("0");
    const hover = declarations(".thread-draft-discard:hover");
    expect(hover.get("color")).toBe("var(--danger)");
    expect(declarations(".thread-draft-discard:focus-visible").get("color")).toBe("var(--danger)");
  });

  it("covers the whole compose with the drop target without adding a box around the form", () => {
    expect(declarations(".compose-drop-zone").get("display")).toBe("contents");
    // The overlay's inherited radius passes through the zone from the panel
    expect(declarations(".compose-drop-zone").get("border-radius")).toBe("inherit");
    expect(declarations(".compose-drop-overlay").get("border-radius")).toBe("inherit");
    const overlay = declarations(".compose-drop-overlay");
    expect(overlay.get("position")).toBe("absolute");
    expect(overlay.get("inset")).toBe("0");
    // The drop lands on the form under it, inside the zone
    expect(overlay.get("pointer-events")).toBe("none");
    expect(declarations(".compose-panel").get("position")).toBe("fixed");
    expect(declarations(".inline-compose").get("position")).toBe("relative");
  });
});
