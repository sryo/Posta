import { describe, it, expect } from "vitest";
import { parseRules, type Rule } from "./test/css";
import { readRepoFile } from "./test/files";
import { contrast, over, resolveColor, tokenScope, type RGBA, type Theme } from "./test/color";
import { CARD_COLORS } from "./shared/constants";

const css = readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);
const THEMES = ["light", "dark"] as const;
const DARK = "@media (prefers-color-scheme: dark)";

function declarations(selector: string, context = ""): Map<string, string> {
  return new Map(rules.filter((rule) => rule.selectors.includes(selector) && rule.context === context).flatMap((rule) => rule.declarations));
}

// A selector that styles an icon itself rather than its host: its last
// compound names svg or an .icon class
const lastCompound = (selector: string) => selector.trim().split(/\s*[\s>+~]\s*/).pop() ?? "";
const isIconSelector = (selector: string) => /(^|[^\w-])svg(?![\w-])|\.icon(?![\w-])|\.icon-(meta|ui|tool|on)(?![\w-])/.test(lastCompound(selector));

const iconRules = (): [Rule, string][] =>
  rules.flatMap((rule) => rule.selectors.filter(isIconSelector).map((sel) => [rule, sel] as [Rule, string]));

const SIZE_PROPS = /^(width|height|min-width|min-height|max-width|max-height|inline-size|block-size)$/;

describe("icon sizes", () => {
  it("recognises a selector that styles an icon", () => {
    for (const sel of [".thread-toolbar-btn svg", "svg.icon", ".invite-when svg.icon-meta", ".x > svg", "svg.icon .icon-wash"]) {
      expect(isIconSelector(sel.replace(/ \.icon-wash$/, "")), sel).toBe(true);
    }
    for (const sel of [".icon-btn", ".invite-when", ".svg-host", ".icon-button svg-like"]) {
      expect(isIconSelector(sel), sel).toBe(false);
    }
  });

  it("ties three size tokens to the type roles", () => {
    const scope = tokenScope(rules, "light");
    const px = (name: string) => {
      let v = scope.get(name)!;
      while (v?.startsWith("var(")) v = scope.get(v.slice(4, -1))!;
      return v;
    };
    expect(px("--icon-meta")).toBe("12px");
    expect(px("--icon-ui")).toBe("14px");
    expect(px("--icon-tool")).toBe("20px");
    expect(scope.get("--icon-meta")).toBe("var(--size-12)");
    expect(scope.get("--icon-ui")).toBe("var(--size-14)");
    expect(scope.get("--icon-tool")).toBe("var(--size-20)");
  });

  it("sizes every icon from its size class, through one rule", () => {
    const icon = declarations("svg.icon");
    expect(icon.get("width")).toBe("var(--icon-size)");
    expect(icon.get("height")).toBe("var(--icon-size)");
    expect(icon.get("flex-shrink")).toBe("0");
    for (const size of ["meta", "ui", "tool"]) {
      expect(declarations(`svg.icon-${size}`).get("--icon-size"), size).toBe(`var(--icon-${size})`);
    }
  });

  it("sets no ad hoc size, and no opacity, on an icon selector", () => {
    const offenders = iconRules().flatMap(([rule, sel]) =>
      rule.declarations
        .filter(([prop, value]) => (SIZE_PROPS.test(prop) && value !== "var(--icon-size)") || prop === "opacity")
        .map(([prop, value]) => `${sel} { ${prop}: ${value} }`),
    );
    expect(offenders).toEqual([]);
  });

  it("colours an icon through its host, never on the svg", () => {
    const offenders = iconRules().flatMap(([rule, sel]) =>
      rule.declarations
        .filter(([prop, value]) =>
          prop === "color" ||
          ((prop === "fill" || prop === "stroke") && !/^(var\(--icon-fill\)|none|currentColor|CanvasText)$/.test(value)))
        .map(([prop, value]) => `${sel} { ${prop}: ${value} }`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("icon wash", () => {
  it("fills the wash plate from --icon-fill and offsets it by the size's plate step", () => {
    const wash = declarations("svg.icon .icon-wash");
    expect(wash.get("fill")).toBe("var(--icon-fill)");
    expect(wash.get("transform")).toBe("translate(var(--icon-offset), var(--icon-offset))");
    for (const size of ["meta", "ui", "tool"]) {
      expect(declarations(`svg.icon-${size}`).get("--icon-offset"), size).toBe(`var(--icon-offset-${size})`);
    }
    // At 12px an offset reads as blur, so the plates print in register
    expect(tokenScope(rules, "light").get("--icon-offset-meta")).toBe("0px");
  });

  it("keeps the wash at 12px only on glyphs with a wide body", () => {
    const rule = rules.find((r) => !r.context && r.selectors.some((s) => s.startsWith("svg.icon-meta:not(") && s.endsWith(".icon-wash")));
    expect(new Map(rule?.declarations).get("fill")).toBe("none");
    for (const name of ["calendar", "clock", "location", "video", "warning", "-circle"]) {
      expect(rule?.selectors.join(","), name).toContain(`"${name}"`);
    }
  });

  it("snaps an on state into register, printed in ink", () => {
    const on = declarations("svg.icon.icon-on");
    expect(on.get("--icon-offset")).toBe("0px");
    expect(on.get("--icon-fill")).toBe("currentColor");
  });

  it("drops the wash under forced colours", () => {
    const forced = rules.find((r) => r.context === "@media (forced-colors: active)" && r.selectors.includes("svg.icon .icon-wash"));
    expect(new Map(forced?.declarations).get("fill")).toBe("none");
  });

  it("builds every wash from a token, never a colour of its own", () => {
    const TOKEN_FILL = /^(var\(--[\w-]+\)|currentColor|transparent|color-mix\(in srgb, (var\(--[\w-]+\)|currentColor) var\(--icon-wash-[\w-]+\), transparent\))$/;
    const fills = rules.flatMap((rule) => rule.declarations.filter(([prop]) => prop === "--icon-fill" || prop.startsWith("--icon-fill-")));
    expect(fills.length).toBeGreaterThan(5);
    expect(fills.filter(([, value]) => !TOKEN_FILL.test(value))).toEqual([]);
  });

  it("takes the wash from where the icon sits", () => {
    const fill = (selector: string) => declarations(selector).get("--icon-fill");
    expect(tokenScope(rules, "light").get("--icon-fill")).toBe("var(--icon-fill-accent)");
    expect(tokenScope(rules, "light").get("--icon-fill-accent")).toContain("var(--accent)");
    // the card's hue inside a card, a file tile or a preset
    for (const sel of [".card[data-color]", ".preset-card", ".attachment-icon"]) expect(fill(sel), sel).toContain("var(--card-hue)");
    // floating chrome takes the accent even over a card
    for (const sel of [".thread-floating-bar", ".compose-panel", ".account-chooser-dropdown", ".undo-toast"]) {
      expect(fill(sel), sel).toBe("var(--icon-fill-accent)");
    }
    // answers say their status; a clash warns
    expect(fill(".invite-answer.accepted")).toBe("var(--icon-fill-success)");
    expect(fill(".invite-answer-item.accepted")).toBe("var(--icon-fill-success)");
    expect(fill(".invite-answer.tentative")).toBe("var(--icon-fill-warning)");
    expect(fill(".invite-answer-item.tentative")).toBe("var(--icon-fill-warning)");
    expect(fill(".invite-answer.declined")).toBe("var(--icon-fill-neutral)");
    expect(fill(".invite-answer-item.declined")).toBe("var(--icon-fill-neutral)");
    expect(fill(".invite-clash")).toBe("var(--icon-fill-warning)");
    expect(fill(".card-error")).toBe("var(--icon-fill-warning)");
    // a past or struck time goes ink only
    expect(fill(".invite-when.past")).toBe("transparent");
    // the solid accent buttons wash in their label colour
    expect(fill(".compose-btn")).toBe("var(--icon-fill-on-accent)");
    expect(fill(".new-event-btn")).toBe("var(--icon-fill-on-accent)");
  });

  it("builds each status wash from its status token", () => {
    const scope = tokenScope(rules, "light");
    expect(scope.get("--icon-fill-success")).toContain("var(--success)");
    expect(scope.get("--icon-fill-warning")).toContain("var(--warning)");
    expect(scope.get("--icon-fill-danger")).toContain("var(--danger)");
    expect(scope.get("--icon-fill-neutral")).toBe("var(--surface-hover)");
    expect(scope.get("--icon-fill-on-accent")).toContain("var(--text-on-accent)");
  });

  it("gives the pale hues less wash in dark mode, where it lifts the background", () => {
    expect(declarations('.card[data-color="yellow"]', DARK).get("--icon-wash-card-mix")).toBe("16%");
    expect(declarations('.card[data-color="orange"]', DARK).get("--icon-wash-card-mix")).toBe("28%");
    expect(declarations('.card[data-color="yellow"]').get("--icon-wash-card-mix")).toBe("40%");
  });
});

// Tokens as computed inside a card of `hue`
function cardTokens(theme: Theme, hue: string) {
  const scope = tokenScope(rules, theme, [".card[data-color]", `.card[data-color="${hue}"]`]);
  return (name: string) => resolveColor(`var(${name})`, scope);
}

// Every ink an icon takes inside a card, as its host's text token
const CARD_INKS = ["--text-secondary", "--text-muted", "--card-ink-text", "--text-link", "--success-text", "--warning-text"];

// Ink ratios under `min` where the ink crosses the wash, on a read and an unread row
function washedUnder(theme: Theme, min: number): string[] {
  const low: string[] = [];
  for (const hue of CARD_COLORS) {
    const token = cardTokens(theme, hue);
    const read = over(token("--card-tint"), token("--surface-app"));
    const rows: [string, RGBA][] = [["read", read], ["unread", over(token("--surface-unread"), read)]];
    for (const [row, bg] of rows) {
      const washed = over(token("--icon-fill"), bg);
      for (const ink of CARD_INKS) {
        const ratio = contrast(token(ink), washed);
        if (ratio < min) low.push(`${hue} ${row} ${ink} ${ratio.toFixed(2)}`);
      }
    }
  }
  return low;
}

describe("icon ink over the wash", () => {
  for (const theme of THEMES) {
    it(`keeps every ink at 3:1 where it crosses the wash, on every card tint (${theme})`, () => {
      expect(washedUnder(theme, 3)).toEqual([]);
    });
  }

  it("shows the wash on every card: it is a visible plate, not a no-op", () => {
    for (const theme of THEMES) {
      for (const hue of CARD_COLORS) {
        expect(cardTokens(theme, hue)("--icon-fill")[3], `${theme} ${hue}`).toBeGreaterThanOrEqual(0.16);
      }
    }
  });

  for (const theme of THEMES) {
    it(`keeps chrome and answer inks at 3:1 over their wash (${theme})`, () => {
      const scope = tokenScope(rules, theme);
      const token = (name: string) => resolveColor(`var(${name})`, scope);
      const low: string[] = [];
      for (const surface of ["--surface-card", "--surface-overlay"]) {
        const bg = over(token(surface), token("--surface-app"));
        const pairs: [string, string][] = [
          ["--icon-fill-accent", "--text-primary"], ["--icon-fill-accent", "--text-secondary"], ["--icon-fill-accent", "--text-link"],
          ["--icon-fill-success", "--success-text"], ["--icon-fill-warning", "--warning-text"], ["--icon-fill-neutral", "--danger-text"],
          ["--icon-fill-danger", "--danger-text"],
        ];
        for (const [fill, ink] of pairs) {
          const ratio = contrast(token(ink), over(token(fill), bg));
          if (ratio < 3) low.push(`${surface} ${fill} ${ink} ${ratio.toFixed(2)}`);
        }
      }
      expect(low).toEqual([]);
    });
  }
});
