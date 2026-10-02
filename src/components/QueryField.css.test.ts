import { describe, it, expect } from "vitest";
import { parseRules } from "../test/css";
import { readRepoFile } from "../test/files";

const rules = parseRules(readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, ""));

function declarations(selector: string): Map<string, string> {
  return new Map(rules.filter(rule => rule.selectors.includes(selector) && !rule.context).flatMap(rule => rule.declarations));
}

describe("query chips", () => {
  it("strikes nothing through on an excluding chip, which says not instead", () => {
    expect(declarations(".query-chip.negated").get("text-decoration")).toBeUndefined();
    expect(declarations(".query-chip-not").get("color")).toBe("var(--text-muted)");
  });

  it("sets OR and AND in muted meta type, at the chips' size", () => {
    const joiner = declarations(".query-joiner");
    expect(joiner.get("font")).toBe("var(--type-meta)");
    expect(joiner.get("color")).toBe("var(--text-muted)");
  });
});
