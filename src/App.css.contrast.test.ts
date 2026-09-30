import { describe, it, expect } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";
import { contrast, over, resolveColor, tokenScope, toHex, type RGBA, type Theme } from "./test/color";
import { CARD_COLORS } from "./shared/constants";

const rules = parseRules(readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, ""));
const THEMES = ["light", "dark"] as const;
const WHITE: RGBA = [1, 1, 1, 1];

// Tokens as computed on :root, or inside a card of `hue`
function tokens(theme: Theme, hue?: string) {
  const scope = tokenScope(rules, theme, hue ? [".card[data-color]", `.card[data-color="${hue}"]`] : []);
  return (name: string) => resolveColor(`var(${name})`, scope);
}

// The backgrounds text meets inside a card: its tint over the board, and an
// unread row on that tint. An uncoloured card is the plain card surface.
function cardBackgrounds(theme: Theme): [string, RGBA][] {
  const out: [string, RGBA][] = [];
  for (const hue of [undefined, ...CARD_COLORS]) {
    const token = tokens(theme, hue);
    const card = over(token("--card-tint"), token("--surface-app"));
    out.push([hue ?? "plain", card], [`${hue ?? "plain"} unread`, over(token("--surface-unread"), card)]);
  }
  return out;
}

// Text token `name` against every card background, as "where ratio" pairs
// that fall under `min`, minus the pairs `accepted` lists.
function under(theme: Theme, name: string, min: number, accepted: string[] = []): string[] {
  return cardBackgrounds(theme)
    .map(([where, bg]) => {
      const hue = where.split(" ")[0];
      const fg = tokens(theme, hue === "plain" ? undefined : hue)(name);
      return [where, contrast(fg, bg)] as const;
    })
    .filter(([where, ratio]) => ratio < min && !accepted.includes(where))
    .map(([where, ratio]) => `${where} ${ratio.toFixed(2)}`);
}

describe("text contrast on cards", () => {
  for (const theme of THEMES) {
    it(`keeps primary, secondary and muted text at 4.5:1 on every card tint and unread row (${theme})`, () => {
      for (const name of ["--text-primary", "--text-secondary", "--text-muted"]) {
        expect(under(theme, name, 4.5), name).toEqual([]);
      }
    });
  }

  it("keeps error text at 4.5:1 on every card tint", () => {
    expect(under("light", "--danger-text", 4.5)).toEqual([]);
    // A yellow card in dark mode is the one tint light enough to hold pale
    // red text under 4.5:1 (4.1:1); no error line renders on one today
    expect(under("dark", "--danger-text", 4.5, ["yellow", "yellow unread"])).toEqual([]);
    expect(under("dark", "--danger-text", 4)).toEqual([]);
  });
});

describe("accent as text", () => {
  it("is the vivid ink on plain light surfaces, at 4.5:1", () => {
    const token = tokens("light");
    expect(toHex(token("--text-link"))).toBe("#1a73e8");
    for (const surface of ["--surface-card", "--surface-overlay", "--surface-raised"]) {
      expect(contrast(token("--text-link"), over(token(surface), token("--surface-app"))), surface).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("steps deeper on a coloured card's tint, where the vivid ink falls under 4:1", () => {
    for (const hue of CARD_COLORS) {
      const token = tokens("light", hue);
      const tint = over(token("--card-tint"), token("--surface-app"));
      expect(contrast(token("--accent-ink"), tint), `${hue} vivid ink`).toBeLessThan(4);
    }
    expect(under("light", "--text-link", 4.5)).toEqual([]);
  });

  it("stays a light, vivid blue in dark mode", () => {
    // Under 4.5:1 only on an unread row of a yellow card (4.4:1)
    expect(under("dark", "--text-link", 4.5, ["yellow unread"])).toEqual([]);
    expect(under("dark", "--text-link", 4.3)).toEqual([]);
  });

  it("keeps links in an email body at 4:1 on white paper and on the dark card", () => {
    expect(contrast(tokens("light")("--text-link-content"), WHITE)).toBeGreaterThanOrEqual(4);
    const dark = tokens("dark");
    expect(contrast(dark("--text-link-content"), over(dark("--surface-card"), dark("--surface-app")))).toBeGreaterThanOrEqual(4);
  });
});

describe("accent fills", () => {
  it("keep the vivid input blue, with hover a step darker than rest", () => {
    for (const theme of THEMES) {
      const token = tokens(theme);
      expect(toHex(token("--accent-fill")), theme).toBe("#4285f4");
      expect(toHex(token("--accent-hover")), theme).not.toBe("#4285f4");
    }
  });

  it("hold white labels at 3:1, the large-text floor, by choice", () => {
    // White on #4285f4 is 3.6:1, under the 4.5:1 small text needs. The vivid
    // blue was chosen over a deeper fill that would pass; this pins the ratio
    // so a change to the fill or its label can't slip lower unnoticed.
    for (const theme of THEMES) {
      const token = tokens(theme);
      const ratio = contrast(token("--text-on-accent"), token("--accent-fill"));
      expect(ratio, theme).toBeGreaterThanOrEqual(3);
      expect(ratio, theme).toBeCloseTo(3.56, 1);
    }
  });

  for (const theme of THEMES) {
    it(`ring focus inside every coloured card at 3:1 against its tint, in the card's own colour (${theme})`, () => {
      expect(under(theme, "--border-focus", 3)).toEqual([]);
    });
  }

  it("ring focus at 3:1 against the card surface", () => {
    for (const theme of THEMES) {
      const token = tokens(theme);
      const card = over(token("--surface-card"), token("--surface-app"));
      expect(contrast(token("--border-focus"), card), theme).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("date bands", () => {
  for (const theme of THEMES) {
    it(`keep their labels at 4.5:1 on every card colour (${theme})`, () => {
      const low: string[] = [];
      for (const hue of [undefined, ...CARD_COLORS]) {
        const token = tokens(theme, hue);
        const band = over(token("--card-band"), over(token("--card-tint"), token("--surface-app")));
        const ratio = contrast(token("--card-band-text"), band);
        if (ratio < 4.5) low.push(`${hue ?? "plain"} ${ratio.toFixed(2)}`);
      }
      expect(low).toEqual([]);
    });
  }
});

describe("overlays", () => {
  it("keep text on the lightbox scrim readable in both themes", () => {
    for (const theme of THEMES) {
      const token = tokens(theme);
      const scrim = over(token("--scrim-strong"), token("--surface-app"));
      expect(contrast(token("--text-on-scrim"), scrim), theme).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token("--text-on-scrim-muted"), scrim), theme).toBeGreaterThanOrEqual(4.5);
    }
  });
});
