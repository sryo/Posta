import { describe, it, expect } from "vitest";
import { parseRules, selectorClasses, unusedKeyframes } from "./test/css";
import { readRepoFile } from "./test/files";

const css = readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, "");

const sources = Object.entries(
  import.meta.glob(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}", "!./test/**"], {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);

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

// Classes rendered only so code and tests can find the element; inline styles
// or other classes carry their look.
const UNSTYLED_HOOKS = new Set([
  "time-picker-start",
  "time-picker-end",
]);

// Class names in `class="..."`, and every string literal or template text
// inside `class={...}` / `classList={{...}}` expressions (ternary branches,
// classList keys).
function renderedClasses(tsx: string): string[] {
  const out: string[] = [];
  const addTokens = (s: string) => {
    for (const t of s.split(/\s+/)) if (/^-?[A-Za-z_][\w-]*$/.test(t)) out.push(t);
  };
  for (const m of tsx.matchAll(/\bclass="([^"]*)"/g)) addTokens(m[1]);
  for (const m of tsx.matchAll(/\bclass(?:List)?=\{/g)) {
    let depth = 1;
    let j = m.index! + m[0].length;
    const start = j;
    while (j < tsx.length && depth > 0) {
      if (tsx[j] === "{") depth++;
      else if (tsx[j] === "}") depth--;
      j++;
    }
    const expr = tsx.slice(start, j - 1);
    // Literals compared against (`state === 'fresh'`) are values, not classes.
    for (const lit of expr.matchAll(/(?<![=!]=\s*)(?:"([^"\n]*)"|'([^'\n]*)')/g)) addTokens(lit[1] ?? lit[2]);
    for (const tpl of expr.matchAll(/`([^`]*)`/g)) addTokens(tpl[1].replace(/\$\{[^}]*\}/g, " "));
    if (m[0].startsWith("classList")) {
      for (const key of expr.matchAll(/(?:^|[{,])\s*([A-Za-z_][\w-]*)\s*:/g)) out.push(key[1]);
    }
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
    // Inline styles in components read the same tokens
    for (const text of [css, ...sources.map(([, t]) => t)]) {
      for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
        if (!m[2] && !defined.has(m[1])) undefinedVars.add(m[1]);
      }
    }
    expect([...undefinedVars]).toEqual([]);
  });

  it("gives no fallback to tokens that :root always defines", () => {
    const rootTokens = new Set<string>();
    for (const rule of rules) {
      if (rule.selectors.length === 1 && rule.selectors[0] === ":root") {
        for (const [prop] of rule.declarations) rootTokens.add(prop);
      }
    }
    expect(rootTokens.has("--text-secondary")).toBe(true);
    const needless = new Set<string>();
    for (const text of [css, ...sources.map(([, t]) => t)]) {
      for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*,/g)) {
        if (rootTokens.has(m[1])) needless.add(m[1]);
      }
    }
    expect([...needless].sort()).toEqual([]);
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
    const unused = [...selectorClasses(rules)].filter(
      (c) => !new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(literals),
    );
    expect(unused.sort()).toEqual([]);
  });

  it("styles every class the app renders", () => {
    const styled = selectorClasses(rules);
    const unstyled = new Set<string>();
    for (const [path, text] of sources) {
      if (!path.endsWith(".tsx")) continue;
      for (const cls of renderedClasses(text)) {
        if (!styled.has(cls) && !UNSTYLED_HOOKS.has(cls)) unstyled.add(cls);
      }
    }
    expect([...unstyled].sort()).toEqual([]);
  });

  it("lets native controls and scrollbars follow the dark palette", () => {
    const root = rules.find((r) => r.context === "" && r.selectors.join(",") === ":root");
    const scheme = new Map(root?.declarations ?? []).get("color-scheme") ?? "";
    expect(scheme.split(/\s+/).sort()).toEqual(["dark", "light"]);
  });

  it("has no keyframes that no animation plays", () => {
    expect(unusedKeyframes(css)).toEqual([]);
  });

  it("declares each selector list in a single rule per context", () => {
    const seen = new Set<string>();
    const repeated: string[] = [];
    for (const rule of rules) {
      const key = `${rule.context} ${rule.selectors.join(", ")}`.trim();
      if (seen.has(key)) repeated.push(key);
      seen.add(key);
    }
    expect(repeated).toEqual([]);
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
