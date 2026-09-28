import { describe, it, expect } from "vitest";
import { parseRules, selectorClasses, unusedKeyframes } from "./test/css";
import { readRepoFile } from "./test/files";

const page = readRepoFile("docs/index.html");

const between = (open: string, close: string) =>
  page.slice(page.indexOf(open) + open.length, page.indexOf(close));
const css = between("<style>", "</style>").replace(/\/\*[\s\S]*?\*\//g, "");
const markup = between("</style>", "<script>");
const script = between("<script>", "</script>");
const rules = parseRules(css);

describe("landing page (docs/index.html)", () => {
  it("parses its stylesheet and script", () => {
    expect(rules.length).toBeGreaterThan(200);
    expect(script).toContain("addEventListener");
  });

  it("has no class selectors that neither the markup nor the demo script uses", () => {
    const used = new Set<string>();
    for (const m of markup.matchAll(/\bclass="([^"]*)"/g)) {
      for (const c of m[1].split(/\s+/)) used.add(c);
    }
    const literals = (script.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? []).join("\n");
    const unused = [...selectorClasses(rules)].filter(
      // A leading "." is a selector lookup (querySelector), which reads a class
      // rather than applying one.
      (c) => !used.has(c) && !new RegExp(`(?<![\\w.-])${c}(?![\\w-])`).test(literals),
    );
    expect(unused.sort()).toEqual([]);
  });

  it("only reads custom properties that are defined somewhere", () => {
    const defined = new Set([...page.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    for (const m of script.matchAll(/["'`](--[\w-]+)["'`]/g)) defined.add(m[1]);
    const missing = new Set<string>();
    for (const m of page.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
      if (!m[2] && !defined.has(m[1])) missing.add(m[1]);
    }
    expect([...missing].sort()).toEqual([]);
  });

  it("has no custom properties that nothing reads", () => {
    const read = new Set([...page.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
    const unread = new Set<string>();
    for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) if (!read.has(m[1])) unread.add(m[1]);
    expect([...unread].sort()).toEqual([]);
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

  it("uses the app's palette for every theme token it shares with App.css", () => {
    const appRules = parseRules(readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, ""));
    const tokens = (from: typeof rules, context: string) =>
      new Map(
        from
          .filter((r) => r.context === context && r.selectors.join(",") === ":root")
          .flatMap((r) => r.declarations.filter(([prop]) => prop.startsWith("--"))),
      );
    const drift: string[] = [];
    let shared = 0;
    for (const context of ["", "@media (prefers-color-scheme: dark)"]) {
      const app = tokens(appRules, context);
      for (const [prop, value] of tokens(rules, context)) {
        if (!app.has(prop)) continue;
        shared++;
        if (app.get(prop) !== value) drift.push(`${context || "light"} ${prop}: ${value} vs app ${app.get(prop)}`);
      }
    }
    expect(shared).toBeGreaterThan(20);
    expect(drift).toEqual([]);
  });

  it("runs the demo script against its markup without throwing", () => {
    document.body.innerHTML = markup;
    expect(() => new Function(script)()).not.toThrow();
    expect(document.querySelectorAll("#demo-deck .card").length).toBeGreaterThan(0);
  });

  it("links only to anchors that exist", () => {
    const ids = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const targets = [...markup.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    const byId = [...script.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map((m) => m[1]);
    expect([...targets, ...byId].filter((id) => !ids.has(id))).toEqual([]);
  });
});
