import { describe, expect, it } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";

const css = readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);

function declaration(selector: string, prop: string): string | undefined {
  const rule = rules.find(r => r.selectors.includes(selector) && !r.context && r.declarations.some(([p]) => p === prop));
  return rule?.declarations.find(([p]) => p === prop)?.[1];
}

describe("a later version of a file", () => {
  it("stacks the line under its attachment in quiet meta type, its action a link", () => {
    expect(declaration(".attachment-entry", "display")).toBe("contents");
    expect(declaration(".attachment-noted", "display")).toBe("flex");
    expect(declaration(".attachment-noted", "flex-direction")).toBe("column");
    expect(declaration(".attachment-later", "font")).toBe("var(--type-meta)");
    expect(declaration(".attachment-later", "color")).toBe("var(--text-secondary)");
    expect(declaration(".attachment-later-open", "color")).toBe("var(--text-link)");
  });

  it("says it under the lightbox's file in the scrim's muted ink", () => {
    expect(declaration(".lightbox-footer", "color")).toBe("var(--text-on-scrim-muted)");
    expect(declaration(".lightbox-footer", "justify-content")).toBe("center");
  });
});
