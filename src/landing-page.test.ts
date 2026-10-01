import { describe, it, expect } from "vitest";
import { parseRules, selectorClasses, unusedKeyframes } from "./test/css";
import { readRepoFile } from "./test/files";
import { resolveColor, tokenScope, toHex } from "./test/color";

const page = readRepoFile("docs/index.html");

const between = (open: string, close: string) =>
  page.slice(page.indexOf(open) + open.length, page.indexOf(close));
const css = between("<style>", "</style>").replace(/\/\*[\s\S]*?\*\//g, "");
const markup = between("</style>", "<script>");
const script = between("<script>", "</script>");
const rules = parseRules(css);

describe("landing page (docs/index.html)", () => {
  it("downloads the latest Mac app straight from its download link", () => {
    const link = markup.match(/<a href="([^"]*)" class="download-link">([^<]*)<\/a>/);
    expect(link?.[1]).toBe("https://github.com/sryo/Posta/releases/latest/download/Posta.dmg");
    expect(link?.[2]).toBe("Download for Mac");
  });

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

  it("uses the app's palette for every colour token it mirrors from App.css", () => {
    const appRules = parseRules(readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, ""));
    // The page keeps the app's older, shorter names; each stands for one role
    const ROLES: Record<string, string> = {
      "--bg-primary": "--surface-card",
      "--bg-secondary": "--surface-app",
      "--bg-tertiary": "--surface-subtle",
      "--bg-hover": "--surface-hover",
      "--text-primary": "--text-primary",
      "--text-secondary": "--text-secondary",
      "--text-muted": "--text-muted",
      "--border-color": "--border-default",
      "--border-light": "--border-subtle",
      "--accent": "--accent-fill",
      "--shadow": "--shadow-color",
      "--danger": "--danger-text",
      "--danger-bg": "--danger-tint",
    };
    const drift: string[] = [];
    for (const theme of ["light", "dark"] as const) {
      const pageScope = tokenScope(rules, theme);
      const appScope = tokenScope(appRules, theme);
      for (const [name, role] of Object.entries(ROLES)) {
        expect(pageScope.has(name), name).toBe(true);
        const [ours, app] = [resolveColor(`var(${name})`, pageScope), resolveColor(`var(${role})`, appScope)];
        const same = ours.every((c, i) => Math.abs(c - app[i]) < 1 / 255);
        if (!same) drift.push(`${theme} ${name}: ${toHex(ours)}/${ours[3]} vs app ${role} ${toHex(app)}/${app[3].toFixed(2)}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it("runs the demo script against its markup without throwing", () => {
    document.body.innerHTML = markup;
    expect(() => new Function(script)()).not.toThrow();
    expect(document.querySelectorAll("#demo-deck .card").length).toBeGreaterThan(0);
  });

  it("stills entrances, transitions and scrolling under reduced motion but keeps the undo countdown running", () => {
    const reduced = rules.filter((r) => r.context.includes("prefers-reduced-motion: reduce"));
    const calming = reduced.find((r) => {
      const decl = new Map(r.declarations);
      return /!important/.test(decl.get("animation-duration") ?? "") && /!important/.test(decl.get("transition-duration") ?? "");
    });
    expect(calming).toBeDefined();
    document.body.innerHTML = markup + '<div class="undo-toast" id="toast"><div class="toast-progress" id="countdown"></div></div>';
    const calmed = (el: Element) => calming!.selectors.some((sel) => el.matches(sel));
    expect(calmed(document.getElementById("toast")!)).toBe(true);
    expect(calmed(document.getElementById("countdown")!)).toBe(false);

    const html = reduced.find((r) => r.selectors.includes("html"));
    expect(new Map(html?.declarations ?? []).get("scroll-behavior")).toBe("auto");
    for (const m of script.matchAll(/behavior:\s*([^,}]+)/g)) expect(m[1]).toMatch(/prefers-reduced-motion/);
  });

  it("links only to anchors that exist", () => {
    const ids = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const targets = [...markup.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    const byId = [...script.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map((m) => m[1]);
    expect([...targets, ...byId].filter((id) => !ids.has(id))).toEqual([]);
  });
});
