import { describe, it, expect } from "vitest";
import { cascadedDeclarations, parseRules } from "./test/css";
import { readRepoFile } from "./test/files";

const rules = parseRules(readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, ""));

const rootTokens = new Map(
  rules.filter((r) => r.selectors.includes(":root") && r.context === "").flatMap((r) => r.declarations),
);

// Resolves a z-index made of :root tokens, numbers and `calc(a + b)`.
function zIndex(value: string | undefined): number {
  if (!value) return NaN;
  const resolved = value.replace(/var\((--[\w-]+)\)/g, (_, name) => rootTokens.get(name) ?? "NaN");
  const sum = resolved.replace(/^calc\((.*)\)$/, "$1").split("+").map((n) => Number(n.trim()));
  return sum.reduce((a, b) => a + b, 0);
}

describe("reading view stacking", () => {
  it("draws the emoji picker above the focused message's actions wheel", () => {
    document.body.innerHTML = `
      <div class="message-card">
        <div class="message-header"><div class="reaction-btn-container"><div class="emoji-picker" id="picker"></div></div></div>
        <div class="message-actions-wheel open" id="wheel"><button class="message-action-btn"></button></div>
      </div>`;
    const z = (id: string) => zIndex(cascadedDeclarations(rules, document.getElementById(id)!).get("z-index"));
    expect(z("picker")).toBeGreaterThan(z("wheel"));
  });
});
