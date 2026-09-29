import { describe, it, expect } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";
import { contrast, over, resolveColor, tokenScope, type Theme } from "./test/color";
import { CARD_COLORS } from "./shared/constants";

const css = readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);

const STATUSES = ["success", "warning", "danger"] as const;
const THEMES = ["light", "dark"] as const;

// A token as the browser computes it on :root, or inside a card of `hue`
const tokenIn = (theme: Theme, hue?: string) => {
  const scope = tokenScope(rules, theme, hue ? [`.card[data-color]`, `.card[data-color="${hue}"]`] : []);
  return (value: string) => resolveColor(value.startsWith("var(") ? value : `var(${value})`, scope);
};

describe("card pill over a thread or event", () => {
  const decls = (selector: string) => new Map(rules.filter(r => !r.context && r.selectors.includes(selector)).flatMap(r => r.declarations));
  const pill = decls(".thread-bar-card.tinted");

  it("mixes the card colour into the text colour so it reads on its own tint", () => {
    expect(pill.get("background")).toBe("var(--card-tint)");
    expect(pill.get("color")).toBe("var(--card-ink-text)");
  });

  for (const theme of THEMES) {
    it(`keeps every card colour's pill at 4.5:1 in ${theme} mode`, () => {
      for (const hue of CARD_COLORS) {
        const pillScope = tokenScope(rules, theme, [".thread-bar-card[data-hue]", `[data-hue="${hue}"]`]);
        const token = (name: string) => resolveColor(`var(${name})`, pillScope);
        // The floating bar over the thread's own surface
        const bar = over(token("--surface-floating"), token("--surface-card"));
        const bg = over(resolveColor(pill.get("background")!, pillScope), bar);
        expect(contrast(resolveColor(pill.get("color")!, pillScope), bg), hue).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

describe("quiet text on a coloured card", () => {
  const colorOf = (selector: string) =>
    new Map(rules.filter(r => !r.context && r.selectors.includes(selector)).flatMap(r => r.declarations)).get("color");

  for (const selector of [".empty", ".thread-draft-discard"]) {
    for (const theme of THEMES) {
      it(`keeps ${selector} at 4.5:1 on every card colour in ${theme} mode`, () => {
        for (const hue of CARD_COLORS) {
          const token = tokenIn(theme, hue);
          const bg = over(token("--card-tint"), token("--surface-app"));
          expect(contrast(token(colorOf(selector)!), bg), hue).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});

describe("status colour tokens", () => {
  for (const theme of THEMES) {
    const color = tokenIn(theme);

    it(`defines a fill, text and tint for each status in ${theme} mode`, () => {
      const defined = tokenScope(rules, theme);
      for (const s of STATUSES) {
        for (const suffix of ["", "-text", "-tint"]) expect(defined.has(`--${s}${suffix}`), `--${s}${suffix}`).toBe(true);
      }
      expect(defined.has("--text-on-status")).toBe(true);
    });

    it(`keeps each status readable in ${theme} mode`, () => {
      const surface = over(color("--surface-card"), color("--surface-app"));
      for (const s of STATUSES) {
        expect(contrast(color("--text-on-status"), color(`--${s}`)), `text on --${s}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(color(`--${s}-text`), surface), `--${s}-text on the surface`).toBeGreaterThanOrEqual(4.5);
        const tint = over(color(`--${s}-tint`), surface);
        expect(contrast(color(`--${s}-text`), tint), `--${s}-text on its tint`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("fills the selected RSVP segment in its status colour, unlike hover", () => {
    const decls = (selector: string) => new Map(rules.filter(r => r.selectors.includes(selector)).flatMap(r => r.declarations));
    for (const s of STATUSES) {
      const selected = decls(`.rsvp-segment.rsvp-${s}.selected`);
      expect(selected.get("background"), s).toBe(`var(--${s})`);
      expect(selected.get("color"), s).toBe("var(--text-on-status)");
    }
    const hover = decls(".rsvp-segment:hover:not(:disabled):not(.selected)");
    expect(hover.get("background")).toBe("var(--surface-hover)");
  });

  it("sizes Join like the RSVP control beside it above an opened invite", () => {
    const decls = (selector: string) => new Map(rules.filter(r => r.selectors.includes(selector)).flatMap(r => r.declarations));
    expect(decls(".invite-block-md .invite-actions").get("align-items")).toBe("stretch");
    const join = decls(".invite-block-md .invite-actions .calendar-join-btn");
    const segment = decls(".rsvp-control-md .rsvp-segment");
    expect(join.get("font")).toBe(segment.get("font"));
    expect(join.get("font")).toBeDefined();
    expect(join.get("padding")).toBe(segment.get("padding"));
    expect(join.get("border-radius")).toBe("var(--radius-md)");
  });

  it("colours every RSVP and response badge with the status tokens, not literals", () => {
    const offenders = rules
      .filter(r => r.selectors.some(s => /rsvp|response|attendee-status/.test(s)))
      .flatMap(r => r.declarations
        .filter(([prop, value]) => /^(color|background|border-color)$/.test(prop) && /#[0-9a-f]{3,6}\b|rgba?\(/i.test(value))
        .map(([prop, value]) => `${r.selectors.join(", ")} { ${prop}: ${value} }`));
    expect(offenders).toEqual([]);
  });
});
