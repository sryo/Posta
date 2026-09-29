import type { Rule } from "./css";

// Straight (not premultiplied) sRGB channels in 0..1 and an alpha.
export type RGBA = [number, number, number, number];

export type Theme = "light" | "dark";
const DARK = "@media (prefers-color-scheme: dark)";

// The custom properties an element sees: :root's, then each extra selector's
// in the order given (least to most specific), each theme's dark block after
// its light one. A later declaration of the same name wins, which is enough
// for App.css's token chains.
export function tokenScope(rules: Rule[], theme: Theme, selectors: string[] = []): Map<string, string> {
  const scope = new Map<string, string>();
  for (const selector of [":root", ...selectors]) {
    for (const context of theme === "dark" ? ["", DARK] : [""]) {
      for (const rule of rules) {
        if (rule.context !== context || !rule.selectors.includes(selector)) continue;
        for (const [prop, value] of rule.declarations) if (prop.startsWith("--")) scope.set(prop, value);
      }
    }
  }
  return scope;
}

// Resolves a colour value (a literal, a var() chain or a color-mix()) the way
// the browser computes it.
export function resolveColor(value: string, scope: Map<string, string>): RGBA {
  const v = value.trim();
  const fn = /^([a-z-]+)\((.*)\)$/s.exec(v);
  if (fn?.[1] === "var") {
    const [name, fallback] = splitArgs(fn[2]);
    const found = scope.get(name.trim());
    if (found !== undefined) return resolveColor(found, scope);
    if (fallback !== undefined) return resolveColor(fallback, scope);
    throw new Error(`undefined token ${name}`);
  }
  if (fn?.[1] === "color-mix") return colorMix(fn[2], scope);
  return parseLiteral(v);
}

function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "(") depth++;
    else if (args[i] === ")") depth--;
    else if (args[i] === "," && depth === 0) {
      out.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(args.slice(start).trim());
  return out;
}

// Splits on whitespace outside parentheses.
function splitWords(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let word = "";
  for (const ch of text.trim()) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (word) out.push(word);
      word = "";
    } else word += ch;
  }
  if (word) out.push(word);
  return out;
}

function colorMix(args: string, scope: Map<string, string>): RGBA {
  const [space, first, second] = splitArgs(args);
  // "<colour> [<percentage>]", where the percentage may itself be a var()
  const part = (text: string): [RGBA, number | null] => {
    const words = splitWords(text);
    if (words.length === 1) return [resolveColor(words[0], scope), null];
    let pct = words[1];
    while (pct.startsWith("var(")) {
      const [name, fallback] = splitArgs(pct.slice(4, -1));
      pct = scope.get(name) ?? fallback;
    }
    return [resolveColor(words[0], scope), parseFloat(pct) / 100];
  };
  const [a, pa] = part(first);
  const [b, pb] = part(second);
  let p1 = pa ?? (pb === null ? 0.5 : 1 - pb);
  let p2 = pb ?? 1 - p1;
  const sum = p1 + p2;
  p1 /= sum;
  p2 /= sum;
  const inOklab = /oklab/.test(space);
  const to = inOklab ? toOklab : (c: RGBA) => [c[0], c[1], c[2]];
  const from = inOklab ? fromOklab : (c: number[]) => [c[0], c[1], c[2]];
  const alpha = a[3] * p1 + b[3] * p2;
  const [ca, cb] = [to(a), to(b)];
  const mixed = [0, 1, 2].map((i) => (alpha === 0 ? 0 : (ca[i] * a[3] * p1 + cb[i] * b[3] * p2) / alpha));
  const [r, g, bl] = from(mixed);
  return [clamp(r), clamp(g), clamp(bl), alpha * Math.min(sum, 1)];
}

const clamp = (x: number) => Math.min(1, Math.max(0, x));

function parseLiteral(value: string): RGBA {
  const v = value.toLowerCase();
  if (v === "transparent") return [0, 0, 0, 0];
  if (v === "white") return [1, 1, 1, 1];
  if (v === "black") return [0, 0, 0, 1];
  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgb) {
    const [r, g, b, a = "1"] = rgb[1].split(/[\s,/]+/).filter(Boolean);
    return [+r / 255, +g / 255, +b / 255, +a];
  }
  throw new Error(`not a colour: ${value}`);
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab([r, g, b]: RGBA): number[] {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: number[]): number[] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => fromLinear(clamp(c)));
}

// `top` painted over `bottom`.
export function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top[3] + bottom[3] * (1 - top[3]);
  if (a === 0) return [0, 0, 0, 0];
  const ch = (i: number) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a;
  return [ch(0), ch(1), ch(2), a];
}

function luminance([r, g, b]: RGBA): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

// WCAG 2 contrast of text `fg` (possibly translucent) on an opaque `bg`.
export function contrast(fg: RGBA, bg: RGBA): number {
  const [hi, lo] = [luminance(over(fg, bg)), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function toHex([r, g, b]: RGBA): string {
  return `#${[r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
}
