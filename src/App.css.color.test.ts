import { describe, it, expect } from "vitest";
import { parseRules, type Rule } from "./test/css";
import { readRepoFile } from "./test/files";
import { cssColorLiteral } from "./test/colorLiterals";

const css = readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);

// Colour comes in two tiers. Primitives hold every literal; semantic tokens
// name a role and are built from primitives. Both live only in token blocks
// on :root (light, dark, or a board hue). Every other rule names a role.
const isTokenBlock = (rule: Rule) =>
  rule.selectors.every((s) => /^:root(\[data-[\w-]+(="[\w-]+")?\])?$/.test(s));

// Hue plumbing: an element that wears a card or board hue sets --card-hue
// (or a --card-*/--board-* strength) from a primitive, and derives the rest.
const isHuePlumbing = (prop: string) => /^--(card|board)-/.test(prop);

const PRIMITIVE = /var\(\s*(--(?:neutral-\d+|hue-[a-z]+|(?:green|amber|red)-\d+|accent(?:-\d+|-ink)?))\s*[,)]/g;

function where(rule: Rule, prop: string, value: string) {
  return `${rule.selectors.join(", ")} { ${prop}: ${value} }${rule.context ? ` (${rule.context})` : ""}`;
}

describe("colour tiers", () => {
  it("recognises a literal colour in each form", () => {
    for (const value of ["#fff", "#1E88E5", "#00000080", "rgb(0 0 0)", "rgba(0, 0, 0, 0.1)", "hsl(0 0% 0%)",
      "oklch(0.5 0.1 250)", "oklab(0.5 0 0)", "color(srgb 1 1 1)", "white", "1px solid Black",
      "color-mix(in srgb, red 50%, transparent)"]) {
      expect(cssColorLiteral(value), value).not.toBeNull();
    }
    for (const value of ["transparent", "currentColor", "inherit", "var(--hue-red)", "var(--text-primary)",
      'content: "red"', "color-mix(in srgb, var(--accent) 12%, transparent)", "0 0 0 1px var(--border-default)"]) {
      expect(cssColorLiteral(value), value).toBeNull();
    }
  });

  it("recognises a primitive named from a rule", () => {
    for (const value of ["var(--neutral-0)", "var(--hue-blue)", "var(--red-700)", "var(--accent)",
      "var(--accent-300)", "var(--accent-ink)", "color-mix(in srgb, var(--accent) 8%, transparent)"]) {
      expect(value.match(PRIMITIVE), value).not.toBeNull();
    }
    for (const value of ["var(--accent-fill)", "var(--accent-hover)", "var(--accent-tint)", "var(--danger)",
      "var(--danger-text)", "var(--text-link)", "var(--card-hue)"]) {
      expect(value.match(PRIMITIVE), value).toBeNull();
    }
  });

  it("keeps literal colours in the token blocks on :root", () => {
    const offenders = rules
      .filter((rule) => !isTokenBlock(rule))
      .flatMap((rule) => rule.declarations
        .filter(([, value]) => cssColorLiteral(value))
        .map(([prop, value]) => where(rule, prop, value)));
    expect(offenders).toEqual([]);
  });

  it("puts no literal colour in a keyframe", () => {
    const keyframes = css.match(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g) ?? [];
    expect(keyframes.length).toBeGreaterThan(0);
    const values = keyframes.flatMap((block) => [...block.matchAll(/:\s*([^;{}]+)/g)].map((m) => m[1]));
    expect(values.filter((v) => cssColorLiteral(v))).toEqual([]);
  });

  it("names a role, not a primitive, outside the token blocks and hue plumbing", () => {
    const offenders = rules
      .filter((rule) => !isTokenBlock(rule))
      .flatMap((rule) => rule.declarations
        .filter(([prop, value]) => !isHuePlumbing(prop) && value.match(PRIMITIVE))
        .map(([prop, value]) => where(rule, prop, value)));
    expect(offenders).toEqual([]);
  });

  it("sets hue plumbing from a card hue or another plumbing token only", () => {
    const offenders = rules
      .filter((rule) => !isTokenBlock(rule))
      .flatMap((rule) => rule.declarations
        .filter(([prop, value]) => isHuePlumbing(prop) && [...value.matchAll(PRIMITIVE)]
          .some((m) => !/^--(hue-[a-z]+|neutral-\d+)$/.test(m[1])))
        .map(([prop, value]) => where(rule, prop, value)));
    expect(offenders).toEqual([]);
  });

  it("defines every colour token a rule names", () => {
    // Set from script: the card width the user dragged to
    const runtime = ["--card-width"];
    const defined = new Set([...runtime, ...rules.flatMap((rule) => rule.declarations.map(([prop]) => prop))]);
    const used = new Set([...css.matchAll(
      /var\(\s*(--(?:neutral|hue|green|amber|red|accent|text|surface|border|shadow|scrim|success|warning|danger|card|board|avatar|app)(?:-[\w-]+)?)\s*[,)]/g,
    )].map((m) => m[1]));
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });

  it("holds few enough primitives to read at a glance", () => {
    const literals = new Set(
      rules.filter(isTokenBlock).flatMap((rule) => rule.declarations
        .map(([, value]) => cssColorLiteral(value)?.toLowerCase())
        .filter((v): v is string => !!v)),
    );
    expect(literals.size).toBeLessThanOrEqual(32);
  });
});
