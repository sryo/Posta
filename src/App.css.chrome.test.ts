import { describe, it, expect } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";
import { contrast, resolveColor, tokenScope, type Theme } from "./test/color";

const css = readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);
const decls = (selector: string) => new Map(rules.filter(r => !r.context && r.selectors.includes(selector)).flatMap(r => r.declarations));

describe("side panels under the title band", () => {
  // The band drags the window and sits over everything but the account, so
  // a panel's header in it can't be clicked
  for (const selector of [".settings-sidebar", '.sheet[data-placement="side"]']) {
    it(`starts ${selector}'s content below the band`, () => {
      expect(decls(selector).get("padding-top")).toBe("var(--drag-region-height)");
    });
  }
});

describe("settings switch", () => {
  const THEMES: Theme[] = ["light", "dark"];
  const thumb = decls(".settings-switch::after").get("background")!;
  const track = decls(".settings-switch").get("background")!;
  const on = decls('.settings-switch[aria-checked="true"]').get("background")!;

  for (const theme of THEMES) {
    it(`sets its thumb apart from the track, off and on, in ${theme} mode`, () => {
      const scope = tokenScope(rules, theme, []);
      const color = (value: string) => resolveColor(value, scope);
      expect(contrast(color(thumb), color(track))).toBeGreaterThanOrEqual(3);
      expect(contrast(color(thumb), color(on))).toBeGreaterThanOrEqual(3);
    });

    it(`keeps the thumb white in ${theme} mode, as a Mac's switches do`, () => {
      const scope = tokenScope(rules, theme, []);
      expect(resolveColor(thumb, scope)).toEqual([1, 1, 1, 1]);
    });
  }
});
