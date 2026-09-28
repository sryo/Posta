import { describe, it, expect, vi } from "vitest";

type Rule = { selectors: string[]; declarations: [string, string][] };

const { readFileSync } = await vi.importActual<{
  readFileSync(path: string, encoding: "utf8"): string;
}>("node:fs");

// `new URL("./x", import.meta.url)` is rewritten by Vite into a served asset
// path, so resolve against the test file's own location by hand.
const srcDir = decodeURIComponent(import.meta.url.replace(/^file:\/\//, "").replace(/[^/]+$/, ""));
const css = readFileSync(srcDir + "App.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const sources = Object.entries(
  import.meta.glob(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"], {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);

// Flattens nested at-rules (@media, @supports) into their inner style rules;
// @keyframes blocks are skipped since their "selectors" are percentages.
function parseRules(text: string): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  function block(skip: boolean) {
    while (i < text.length) {
      const open = text.indexOf("{", i);
      const close = text.indexOf("}", i);
      if (close !== -1 && (open === -1 || close < open)) {
        i = close + 1;
        return;
      }
      if (open === -1) return;
      const prelude = text.slice(i, open).trim();
      i = open + 1;
      if (prelude.startsWith("@")) {
        block(skip || prelude.startsWith("@keyframes"));
        continue;
      }
      const end = text.indexOf("}", i);
      const body = text.slice(i, end);
      i = end + 1;
      if (skip) continue;
      const declarations = body
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const colon = d.indexOf(":");
          return [d.slice(0, colon).trim(), d.slice(colon + 1).trim()] as [string, string];
        });
      rules.push({ selectors: prelude.split(",").map((s) => s.trim()), declarations });
    }
  }
  block(false);
  return rules;
}

const rules = parseRules(css);

// Declarations that apply to an element carrying exactly these classes, with
// no ancestor context: only rules whose selector is a bare class compound.
function standaloneDeclarations(classes: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of rules) {
    const matches = rule.selectors.some((sel) => {
      if (!/^(\.[\w-]+)+$/.test(sel)) return false;
      return sel.slice(1).split(".").every((c) => classes.includes(c));
    });
    if (matches) for (const [prop, value] of rule.declarations) out.set(prop, value);
  }
  return out;
}

describe("App.css", () => {
  it("parses a meaningful number of rules", () => {
    expect(rules.length).toBeGreaterThan(300);
  });

  it("only references custom properties that are defined somewhere", () => {
    const defined = new Set<string>();
    for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
    for (const [, text] of sources) {
      for (const m of text.matchAll(/["'`](--[\w-]+)["'`]/g)) defined.add(m[1]);
    }
    const undefinedVars = new Set<string>();
    for (const m of css.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
      if (!m[2] && !defined.has(m[1])) undefinedVars.add(m[1]);
    }
    expect([...undefinedVars]).toEqual([]);
  });

  it("has no custom properties that nothing reads", () => {
    const read = new Set<string>();
    for (const text of [css, ...sources.map(([, t]) => t)]) {
      for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) read.add(m[1]);
    }
    const unread = new Set<string>();
    for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) {
      if (!read.has(m[1])) unread.add(m[1]);
    }
    expect([...unread].sort()).toEqual([]);
  });

  it("has no class selectors that nothing in the app renders", () => {
    const literals = sources
      .map(([, text]) => (text.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? []).join("\n"))
      .join("\n");
    const classes = new Set<string>();
    for (const rule of rules) {
      for (const sel of rule.selectors) {
        for (const m of sel.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) classes.add(m[1]);
      }
    }
    const unused = [...classes].filter(
      (c) => !new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(literals),
    );
    expect(unused.sort()).toEqual([]);
  });

  it("never declares the same property twice in one rule", () => {
    const duplicated: string[] = [];
    for (const rule of rules) {
      const seen = new Set<string>();
      for (const [prop] of rule.declarations) {
        if (seen.has(prop)) duplicated.push(`${rule.selectors.join(", ")} { ${prop} }`);
        seen.add(prop);
      }
    }
    expect(duplicated).toEqual([]);
  });

  it("styles the small spinner on its own, as SmartReplies renders it", () => {
    const smartReplies = sources.find(([path]) => path.endsWith("SmartReplies.tsx"))?.[1] ?? "";
    expect(smartReplies).toContain('class="spinner-sm"');
    const decl = standaloneDeclarations(["spinner-sm"]);
    expect(decl.get("animation")).toMatch(/\bspin\b/);
    expect(decl.get("border-top-color")).toBeDefined();
  });
});
