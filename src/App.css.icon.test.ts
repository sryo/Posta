import { describe, it, expect } from "vitest";
import { parseRules, type Rule } from "./test/css";
import { readRepoFile } from "./test/files";
import { tokenScope } from "./test/color";

const css = readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);

function declarations(selector: string, context = ""): Map<string, string> {
  return new Map(rules.filter((rule) => rule.selectors.includes(selector) && rule.context === context).flatMap((rule) => rule.declarations));
}

// A selector that styles an icon itself rather than its host: its last
// compound names svg or an .icon class
const lastCompound = (selector: string) => selector.trim().split(/\s*[\s>+~]\s*/).pop() ?? "";
const isIconSelector = (selector: string) => /(^|[^\w-])svg(?![\w-])|\.icon(?![\w-])|\.icon-(meta|ui|tool)(?![\w-])/.test(lastCompound(selector));

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
          ((prop === "fill" || prop === "stroke") && !/^(none|currentColor|CanvasText)$/.test(value)))
        .map(([prop, value]) => `${sel} { ${prop}: ${value} }`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("line icons", () => {
  it("print no second plate: no fill or offset tokens, no wash rules", () => {
    expect(css).not.toMatch(/--icon-(fill|wash|offset)/);
    expect(css).not.toMatch(/icon-wash|icon-on/);
  });
});
