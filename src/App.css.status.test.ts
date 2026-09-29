import { describe, it, expect } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";
import { COLOR_HEX } from "./shared/constants";

const css = readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);

const STATUSES = ["success", "warning", "danger"] as const;

function rootTokens(dark: boolean): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of rules) {
    if (!rule.selectors.includes(":root")) continue;
    const isDark = rule.context.includes("prefers-color-scheme: dark");
    if (isDark !== dark || (rule.context && !isDark)) continue;
    for (const [prop, value] of rule.declarations) out.set(prop, value);
  }
  return out;
}

type Rgba = [number, number, number, number];

function parseColor(value: string): Rgba {
  const short = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) value = `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = value.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/);
  if (rgba) return [+rgba[1], +rgba[2], +rgba[3], rgba[4] === undefined ? 1 : +rgba[4]];
  throw new Error(`Unparsed colour ${value}`);
}

function over(top: Rgba, base: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map(i => top[i] * a + base[i] * (1 - a)).concat(1) as Rgba;
}

// WCAG 2 relative luminance and contrast ratio
function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("card pill over a thread or event", () => {
  const decls = (selector: string) => new Map(rules.filter(r => !r.context && r.selectors.includes(selector)).flatMap(r => r.declarations));
  const pill = decls(".thread-bar-card.tinted");
  // color-mix(in srgb, var(--pill-color) N%, <other>)
  const share = (value: string | undefined) => Number(value?.match(/var\(--pill-color\) ([\d.]+)%/)?.[1]) / 100;
  const mix = (a: Rgba, b: Rgba, p: number): Rgba => [0, 1, 2].map(i => a[i] * p + b[i] * (1 - p)).concat(1) as Rgba;

  it("mixes the card colour into the text colour so it reads on its own tint", () => {
    expect(pill.get("background")).toMatch(/^color-mix\(in srgb, var\(--pill-color\) [\d.]+%, transparent\)$/);
    expect(pill.get("color")).toMatch(/^color-mix\(in srgb, var\(--pill-color\) [\d.]+%, var\(--text-primary\)\)$/);
  });

  for (const dark of [false, true]) {
    it(`keeps every card colour's pill at 4.5:1 in ${dark ? "dark" : "light"} mode`, () => {
      const tokens = rootTokens(dark);
      const text = parseColor(tokens.get("--text-primary")!);
      // The floating bar: translucent white in light mode, elevated grey in dark
      const bar = dark ? parseColor("#2b2b2b") : parseColor("#ffffff");
      for (const [name, hex] of Object.entries(COLOR_HEX)) {
        const card = parseColor(hex);
        const fg = mix(card, text, share(pill.get("color")));
        const bg = mix(card, bar, share(pill.get("background")));
        expect(contrast(fg, bg), name).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

describe("quiet text on a coloured card", () => {
  const colorOf = (selector: string) =>
    new Map(rules.filter(r => !r.context && r.selectors.includes(selector)).flatMap(r => r.declarations)).get("color");
  const cardTints = (dark: boolean) => rules
    .filter(r => r.selectors.some(s => /^\.card\[data-color="\w+"\]$/.test(s)) && dark === r.context.includes("prefers-color-scheme: dark"))
    .map(r => [r.selectors[0], new Map(r.declarations).get("background")!] as const);

  for (const selector of [".empty", ".thread-draft-discard"]) {
    for (const dark of [false, true]) {
      it(`keeps ${selector} at 4.5:1 on every card colour in ${dark ? "dark" : "light"} mode`, () => {
        const tokens = rootTokens(dark);
        const token = (value: string) => parseColor(tokens.get(value.match(/^var\((--[\w-]+)\)$/)![1])!);
        const board = token("var(--bg-secondary)");
        const tints = cardTints(dark);
        expect(tints.length).toBe(8);
        for (const [card, tint] of tints) {
          const bg = over(parseColor(tint), board);
          expect(contrast(over(token(colorOf(selector)!), bg), bg), card).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});

describe("status colour tokens", () => {
  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    const tokens = rootTokens(dark);
    const color = (name: string) => parseColor(tokens.get(name) ?? rootTokens(false).get(name)!);

    it(`defines a fill, text and tint for each status in ${mode} mode`, () => {
      for (const s of STATUSES) {
        for (const suffix of ["", "-fg", "-bg"]) expect(tokens.has(`--${s}${suffix}`), `--${s}${suffix}`).toBe(true);
      }
      expect(tokens.has("--on-status")).toBe(true);
    });

    it(`keeps each status readable in ${mode} mode`, () => {
      const surface = color("--bg-primary");
      for (const s of STATUSES) {
        expect(contrast(color("--on-status"), color(`--${s}`)), `text on --${s}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(color(`--${s}-fg`), surface), `--${s}-fg on the surface`).toBeGreaterThanOrEqual(4.5);
        const tint = over(color(`--${s}-bg`), surface);
        expect(contrast(color(`--${s}-fg`), tint), `--${s}-fg on its tint`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("fills the selected RSVP segment in its status colour, unlike hover", () => {
    const decls = (selector: string) => new Map(rules.filter(r => r.selectors.includes(selector)).flatMap(r => r.declarations));
    for (const s of STATUSES) {
      const selected = decls(`.rsvp-segment.rsvp-${s}.selected`);
      expect(selected.get("background"), s).toBe(`var(--${s})`);
      expect(selected.get("color"), s).toBe("var(--on-status)");
    }
    const hover = decls(".rsvp-segment:hover:not(:disabled):not(.selected)");
    expect(hover.get("background")).toBe("var(--bg-hover)");
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
