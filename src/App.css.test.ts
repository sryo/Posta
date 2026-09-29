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
  "connection-status-region",
  "message-sender-name",
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

  it("leaves window dragging to data-tauri-drag-region, since no webview the app runs in honours app-region", () => {
    const dragRules = rules.filter((r) => r.declarations.some(([prop]) => /(^|-)app-region$/.test(prop)));
    expect(dragRules.map((r) => r.selectors.join(", "))).toEqual([]);
  });

  it("reveals whatever hovering a control reveals on keyboard focus too", () => {
    const hoverOnly: string[] = [];
    for (const rule of rules) {
      if (new Map(rule.declarations).get("opacity") !== "1") continue;
      for (const sel of rule.selectors) {
        if (!/:hover\s+\S/.test(sel)) continue;
        const keyboard = [":focus-visible", ".focused", ":focus-within"].map((state) => sel.replace(":hover", state));
        if (!keyboard.some((k) => rule.selectors.includes(k))) hoverOnly.push(sel);
      }
    }
    expect(hoverOnly).toEqual([]);
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

describe("card query field", () => {
  const declarationsOf = (selector: string) =>
    new Map(rules.filter((rule) => rule.selectors.includes(selector)).flatMap((rule) => [...rule.declarations]));

  it("keeps the raw query input focusable but out of sight behind its chips until edited", () => {
    const hidden = declarationsOf(".query-field:not(.editing) input");
    expect(hidden.get("position")).toBe("absolute");
    expect(hidden.get("opacity")).toBe("0");
    expect(hidden.get("display")).toBeUndefined();
  });

  it("draws the text box borderless inside the chip box while typing, the box taking the focus colour", () => {
    const box = declarationsOf(".query-chips input");
    expect(box.get("border")).toBe("none");
    expect(box.get("flex")).toBe("0 1 auto");
    expect(declarationsOf(".query-chips input:last-child").get("flex-grow")).toBe("1");
    expect(declarationsOf(".query-chips:focus-within").get("border-color")).toBe("var(--accent)");
  });

  it("shows a failed preview in the danger color", () => {
    expect(declarationsOf(".query-preview-error").get("color")).toBe("var(--danger)");
  });
});

describe("board connection status", () => {
  const declarationsOf = (selector: string) =>
    new Map(rules.filter((rule) => rule.selectors.includes(selector)).flatMap((rule) => [...rule.declarations]));

  it("pushes the deck down by the strip's height instead of covering the cards", () => {
    expect(declarationsOf(".connection-status").get("height")).toBe("var(--status-bar-height)");
    expect(declarationsOf(".deck.has-status").get("padding-top")).toBe("calc(var(--drag-region-height) + var(--status-bar-height) + var(--space-md))");
  });

  it("marks offline in amber and a lost sign-in in the danger color", () => {
    expect(declarationsOf(".connection-status.offline").get("background")).toBe("var(--warning-bg)");
    expect(declarationsOf(".connection-status.expired").get("background")).toBe("var(--danger-bg)");
    expect(declarationsOf(".connection-status.offline").get("color")).toBe("var(--warning-fg)");
    expect(declarationsOf(".connection-status.expired").get("color")).toBe("var(--danger-fg)");
  });

  it("keeps the amber offline text readable on its background in both themes", () => {
    // [light, dark] values of a custom property, in the order App.css defines them
    const token = (name: string) => [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, "g"))].map((m) => m[1].trim());
    const rgba = (value: string): [number, number, number, number] => {
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
      if (hex) {
        const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
      }
      const [r, g, b, a = "1"] = /rgba?\(([^)]+)\)/.exec(value)![1].split(",").map((p) => p.trim());
      return [Number(r), Number(g), Number(b), Number(a)];
    };
    const luminance = ([r, g, b]: number[]) => {
      const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const [text, bg, page] = [token("--warning-fg"), token("--warning-bg"), token("--bg-primary")];
    for (const theme of [0, 1]) {
      const [br, bgG, bb, alpha] = rgba(bg[theme]);
      const [pr, pg, pb] = rgba(page[theme]);
      const under = [br * alpha + pr * (1 - alpha), bgG * alpha + pg * (1 - alpha), bb * alpha + pb * (1 - alpha)];
      const [l1, l2] = [luminance(rgba(text[theme])), luminance(under)].sort((x, y) => y - x);
      expect((l1 + 0.05) / (l2 + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("dims the mail of cards that can't update", () => {
    expect(declarationsOf(".card.stale .card-body").get("opacity")).toBeDefined();
  });

});

describe("accounts on the board", () => {
  const declarationsOf = (selector: string) =>
    new Map(rules.filter((rule) => rule.selectors.includes(selector)).flatMap((rule) => [...rule.declarations]));

  it("follows a card's title with its account in small muted text that gives way before the title does", () => {
    const qualifier = declarationsOf(".card-account-qualifier");
    expect(qualifier.get("font")).toBe("var(--type-meta)");
    expect(qualifier.get("color")).toBe("var(--text-muted)");
    expect(qualifier.get("min-width")).toBe("0");
    expect(qualifier.get("text-overflow")).toBe("ellipsis");
    expect(declarationsOf(".card-title").get("flex-shrink")).toBe("0");
    expect(declarationsOf(".card-account-qualifier.problem").get("color")).toBe("var(--danger)");
  });

  it("widens the account to its full address while the card is hovered or focused", () => {
    expect(declarationsOf(".card-account-qualifier-full").get("display")).toBe("none");
    for (const state of [":hover", ":focus-within"]) {
      expect(declarationsOf(`.card${state} .card-account-qualifier-short`).get("display")).toBe("none");
      expect(declarationsOf(`.card${state} .card-account-qualifier-full`).get("display")).toBe("inline");
    }
  });
  it("shows a compose's sender like the fields below it", () => {
    const from = declarationsOf(".compose-from select");
    const field = declarationsOf(".compose-field input");
    for (const prop of ["flex", "border", "background", "font", "color"]) expect(from.get(prop)).toBe(field.get(prop));
    expect(field.get("font")).toBe("var(--type-ui)");
    expect(declarationsOf(".compose-from-email").get("font")).toBe(field.get("font"));
  });
});

describe("snippet previews", () => {
  it("clamp to five lines from the stylesheet, not from a property the app sets", () => {
    const root = rules.filter((rule) => rule.selectors.includes(":root")).flatMap((rule) => [...rule.declarations]);
    expect(new Map(root).get("--snippet-lines")).toBe("5");
    for (const [, source] of sources) expect(source).not.toContain("--snippet-lines");
  });
});

describe("card header", () => {
  const declarationsOf = (selector: string, context = "") =>
    new Map(rules.filter((rule) => rule.context === context && rule.selectors.includes(selector)).flatMap((rule) => [...rule.declarations]));

  it("makes the title a borderless button with a hover pill, since it collapses the card", () => {
    const title = declarationsOf(".card-title-btn");
    expect(title.get("background")).toBe("none");
    expect(title.get("font")).toBe("inherit");
    expect(title.get("min-width")).toBe("0");
    expect(declarationsOf(".card-title-btn:hover").get("background")).toBe("var(--bg-hover)");
  });

  it("hides refresh and edit at rest without taking them out of the tab order", () => {
    const tools = declarationsOf(".card-actions");
    expect(tools.get("max-width")).toBe("0");
    expect(tools.get("opacity")).toBe("0");
    expect(tools.get("overflow")).toBe("hidden");
    expect(tools.get("display")).not.toBe("none");
    expect(tools.get("transition")).toMatch(/max-width/);
    for (const shown of [".card:hover .card-actions", ".card:focus-within .card-actions", ".card-header.has-problem .card-actions"]) {
      expect(declarationsOf(shown).get("opacity"), shown).toBe("1");
      expect(declarationsOf(shown).get("max-width"), shown).not.toBe("0");
    }
  });

  it("always shows the tools where nothing can hover", () => {
    const tools = declarationsOf(".card-actions", "@media (hover: none)");
    expect(tools.get("opacity")).toBe("1");
    expect(tools.get("max-width")).not.toBe("0");
  });

  it("turns refresh red while the card can't sync, with no dot", () => {
    expect(declarationsOf(".card-header.has-problem .card-refresh").get("color")).toBe("var(--danger)");
  });

  it("stacks the collapsed strip's count above its vertical title and account", () => {
    expect(declarationsOf(".card.collapsed .card-title-btn").get("flex-direction")).toBe("column");
    for (const part of [".card.collapsed .card-title", ".card.collapsed .card-account-qualifier"]) {
      expect(declarationsOf(part).get("writing-mode"), part).toBe("vertical-rl");
    }
    const order = (sel: string) => Number(declarationsOf(sel).get("order") ?? 0);
    expect(order(".card.collapsed .card-unread-badge")).toBeLessThan(order(".card.collapsed .card-title"));
    expect(order(".card.collapsed .card-title")).toBeLessThan(order(".card.collapsed .card-account-qualifier"));
  });
});
