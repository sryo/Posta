import { describe, it, expect } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";

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

  it("colours every RSVP and response badge with the status tokens, not literals", () => {
    const offenders = rules
      .filter(r => r.selectors.some(s => /rsvp|response|attendee-status/.test(s)))
      .flatMap(r => r.declarations
        .filter(([prop, value]) => /^(color|background|border-color)$/.test(prop) && /#[0-9a-f]{3,6}\b|rgba?\(/i.test(value))
        .map(([prop, value]) => `${r.selectors.join(", ")} { ${prop}: ${value} }`));
    expect(offenders).toEqual([]);
  });
});
