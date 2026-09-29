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
});
