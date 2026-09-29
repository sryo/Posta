import { describe, it, expect } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";

const css = readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);

// Type primitives and roles are declared once, on :root; every other rule
// picks a role or a primitive by name.
const tokenRules = rules.filter((rule) => rule.selectors.length === 1 && rule.selectors[0] === ":root");
const styleRules = rules.filter((rule) => !tokenRules.includes(rule));
const tokens = new Map(tokenRules.flatMap((rule) => rule.declarations));

const SIZES = ["10px", "12px", "13px", "14px", "20px"];
const WEIGHTS = ["400", "600"];

const ROLE = /^var\(--type-[a-z]+\)$/;
const SIZE = /^var\(--size-\d+\)$/;
const WEIGHT = /^var\(--weight-[a-z]+\)$/;
const LEADING = /^var\(--leading-[a-z]+\)$/;
const TRACKING = /^var\(--tracking-[a-z]+\)$/;
const FAMILY = /^var\(--font-(ui|mono)\)$/;

// What each typographic property may be set to outside :root.
const ALLOWED: Record<string, RegExp> = {
  font: ROLE,
  "font-size": SIZE,
  "font-weight": WEIGHT,
  "line-height": LEADING,
  "letter-spacing": TRACKING,
  "font-family": FAMILY,
};

// The only raw typographic values outside :root, each a glyph or a fixed box
// rather than text on the type scale.
const EXCEPTIONS: Record<string, string> = {
  // The card header is a fixed 32px row; its title button's line box is the row
  ".card-title-btn line-height": "32px",
  // The postmark is a drawn stamp, tracked out like ink lettering
  ".postmark-text letter-spacing": "1.4px",
  // Drag handle dots are a glyph, pulled together into a grip
  ".action-config-item .drag-handle letter-spacing": "-2px",
  // The quoted-history toggle is a row of dots set as text
  ".quoted-toggle letter-spacing": "1px",
  ".quoted-toggle line-height": "1",
};

function offenders(): string[] {
  const out: string[] = [];
  for (const rule of styleRules) {
    for (const [prop, value] of rule.declarations) {
      const pattern = ALLOWED[prop];
      if (!pattern || value === "inherit" || pattern.test(value)) continue;
      const key = `${rule.selectors.join(", ")} ${prop}`;
      if (EXCEPTIONS[key] === value) continue;
      out.push(`${key}: ${value}${rule.context ? ` (${rule.context})` : ""}`);
    }
  }
  return out;
}

describe("type roles", () => {
  it("draws every size from five steps", () => {
    const sizes = [...tokens].filter(([name]) => name.startsWith("--size-"));
    expect(sizes.map(([, value]) => value).sort((a, b) => parseFloat(a) - parseFloat(b))).toEqual(SIZES);
    for (const [name, value] of sizes) expect(name).toBe(`--size-${parseFloat(value)}`);
  });

  it("uses two weights, regular and strong", () => {
    expect(tokens.get("--weight-regular")).toBe("400");
    expect(tokens.get("--weight-strong")).toBe("600");
    const literals = [...css.matchAll(/font-weight\s*:\s*(\d+)/g)].map((m) => m[1]);
    for (const weight of literals) expect(WEIGHTS).toContain(weight);
  });

  it("builds each role from the primitives only", () => {
    const roles = [...tokens].filter(([name]) => name.startsWith("--type-"));
    expect(roles.map(([name]) => name).sort()).toEqual(
      ["body", "code", "display", "heading", "hint", "label", "meta", "subject", "title", "ui"].map((r) => `--type-${r}`),
    );
    for (const [name, value] of roles) {
      expect(value, name).toMatch(
        /^var\(--weight-[a-z]+\) var\(--size-\d+\)\/(var\(--leading-[a-z]+\)|1) var\(--font-(ui|mono)\)$/,
      );
    }
  });

  it("defines every type token a rule names", () => {
    const used = new Set([...css.matchAll(/var\((--(?:type|size|weight|leading|tracking|font)-[\w-]+)\)/g)].map((m) => m[1]));
    for (const name of used) expect(tokens.has(name), name).toBe(true);
  });

  it("has no size scale besides the roles", () => {
    expect([...tokens.keys()].filter((name) => name.startsWith("--font-size-"))).toEqual([]);
  });

  it("sets no raw size, weight, leading, tracking or family outside :root", () => {
    expect(offenders()).toEqual([]);
  });

  it("keeps each exception in use, so the list can't outlive the rule it excuses", () => {
    const declared = new Set(
      styleRules.flatMap((rule) => rule.declarations.map(([prop, value]) => `${rule.selectors.join(", ")} ${prop}=${value}`)),
    );
    for (const [key, value] of Object.entries(EXCEPTIONS)) expect(declared.has(`${key}=${value}`), key).toBe(true);
  });
});
