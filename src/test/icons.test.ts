import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import * as Icons from "../components/Icons";

const sources = Object.entries(
  import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx"], {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);

// Drawings that live outside the icon set, each with the reason
const SVG_ALLOWED: Record<string, string> = {
  "/components/Icons.tsx": "the icon set itself",
  "/components/CardStates.tsx": "the empty-card postmark illustration and its shared defs",
};

const withoutComments = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("one source for icons", () => {
  it("reads the components it checks", () => {
    expect(sources.some(([file]) => file.endsWith("/App.tsx"))).toBe(true);
    expect(sources.some(([file]) => file.endsWith("/components/Icons.tsx"))).toBe(true);
  });

  it("draws no <svg> outside Icons.tsx but the allowlisted illustration", () => {
    const offenders = sources
      .filter(([file, source]) => !Object.keys(SVG_ALLOWED).some((suffix) => file.endsWith(suffix)) && /<svg\b/.test(withoutComments(source)))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it("keeps each allowlisted file drawing, so the list can't outlive what it excuses", () => {
    for (const suffix of Object.keys(SVG_ALLOWED)) {
      const found = sources.find(([file]) => file.endsWith(suffix));
      expect(found && /<svg\b/.test(found[1]), suffix).toBe(true);
    }
  });
});

type Size = "meta" | "ui" | "tool";
type IconComponent = (props?: { size?: Size; strong?: boolean; on?: boolean; class?: string }) => JSX.Element;

const icons = Object.entries(Icons).filter(([name]) => name.endsWith("Icon")) as [string, IconComponent][];
const SIZES: Size[] = ["meta", "ui", "tool"];
// Stroke in 16-grid units at each size; strong adds 0.3, heavy details are 1.4x
const STROKE: Record<Size, number> = { meta: 1.75, ui: 1.6, tool: 1.5 };
const heavy = (s: number) => Math.round(s * 1.4 * 100) / 100;

// Glyphs with no body, drawn in ink alone
const LINE_GLYPHS = [
  "ChevronIcon", "ChevronLeftIcon", "ChevronRightIcon", "CloseIcon", "ClearIcon", "PlusIcon", "MoreIcon",
  "CheckIcon", "RefreshIcon", "RepeatIcon", "AttachmentIcon", "EyeClosedIcon",
];
const ON_STATES = ["StarFilledIcon", "ThumbsUpFilledIcon"];

function draw(Icon: IconComponent, props: Parameters<IconComponent>[0] = {}): SVGSVGElement {
  const { container, unmount } = render(() => Icon(props));
  const svg = container.querySelector("svg")!;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  unmount();
  return clone;
}

describe("the icon family", () => {
  it("exports the set, with the glyphs that replace unicode", () => {
    const names = icons.map(([name]) => name);
    for (const name of ["WarningIcon", "MoreIcon", "FileIcon", "FileTextIcon", "ImageIcon", "ExternalIcon", "CheckIcon", "CloseIcon"]) {
      expect(names, name).toContain(name);
    }
    expect(names.length).toBeGreaterThanOrEqual(46);
  });

  it("renders every icon hidden from assistive tech, with exactly one size class", () => {
    for (const [name, Icon] of icons) {
      for (const size of [undefined, ...SIZES]) {
        const svg = draw(Icon, size ? { size } : {});
        const classes = [...svg.classList];
        expect(svg.getAttribute("aria-hidden"), name).toBe("true");
        expect(classes, name).toContain("icon");
        expect(classes.filter((c) => /^icon-(meta|ui|tool)$/.test(c)), `${name} ${size}`).toEqual([`icon-${size ?? "ui"}`]);
      }
    }
  });

  it("names each drawing once", () => {
    const names = icons.map(([, Icon]) => draw(Icon).getAttribute("data-icon"));
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it("draws on one 16-unit grid with round caps and joins, in the host's text colour", () => {
    for (const [name, Icon] of icons) {
      const svg = draw(Icon);
      expect(svg.getAttribute("viewBox"), name).toBe("0 0 16 16");
      expect(svg.getAttribute("stroke-linecap"), name).toBe("round");
      expect(svg.getAttribute("stroke-linejoin"), name).toBe("round");
      expect(svg.getAttribute("stroke"), name).toBe("currentColor");
      expect(svg.getAttribute("fill"), name).toBe("none");
      for (const el of svg.querySelectorAll("[stroke-linecap], [stroke-linejoin]")) {
        expect(el.getAttribute("stroke-linecap") ?? "round", name).toBe("round");
        expect(el.getAttribute("stroke-linejoin") ?? "round", name).toBe("round");
      }
    }
  });

  it("steps the stroke with the size, adds weight in strong text, and keeps heavy details at 1.4x", () => {
    for (const [name, Icon] of icons) {
      for (const size of SIZES) {
        for (const strong of [false, true]) {
          const svg = draw(Icon, { size, strong });
          const s = STROKE[size] + (strong ? 0.3 : 0);
          expect(Number(svg.getAttribute("stroke-width")), `${name} ${size}`).toBeCloseTo(s, 5);
          for (const el of svg.querySelectorAll("[stroke-width]")) {
            if (el === svg) continue;
            expect(Number(el.getAttribute("stroke-width")), `${name} ${size} detail`).toBeCloseTo(heavy(s), 5);
          }
        }
      }
    }
  });

  it("prints in two plates: an optional wash under exactly one ink layer", () => {
    for (const [name, Icon] of icons) {
      const svg = draw(Icon);
      const groups = [...svg.children];
      const wash = svg.querySelectorAll(":scope > g.icon-wash");
      expect(svg.querySelectorAll(":scope > g.icon-ink").length, name).toBe(1);
      expect(wash.length, name).toBeLessThanOrEqual(1);
      expect(groups[groups.length - 1]?.classList.contains("icon-ink"), name).toBe(true);
      expect(groups.length, name).toBe(1 + wash.length);
    }
  });

  it("leaves the wash's colour to --icon-fill, never a colour of its own", () => {
    for (const [name, Icon] of icons) {
      const wash = draw(Icon).querySelector("g.icon-wash");
      if (!wash) continue;
      for (const el of [wash, ...wash.querySelectorAll("*")]) {
        expect(el.getAttribute("fill"), name).toBeNull();
        expect(el.getAttribute("stroke"), name).toBeNull();
        expect(el.getAttribute("style"), name).toBeNull();
      }
    }
  });

  it("fills ink details with currentColor only", () => {
    for (const [name, Icon] of icons) {
      for (const el of draw(Icon).querySelectorAll("g.icon-ink [fill]")) {
        expect(el.getAttribute("fill"), name).toBe("currentColor");
      }
    }
  });

  it("gives a wash to glyphs with a body and none to line glyphs", () => {
    for (const [name, Icon] of icons) {
      const hasWash = draw(Icon).querySelector("g.icon-wash") !== null;
      expect(hasWash, name).toBe(!LINE_GLYPHS.includes(name));
    }
  });

  it("prints an on state in register, as a filled export or through the prop", () => {
    for (const [name, Icon] of icons) {
      expect(draw(Icon).classList.contains("icon-on"), name).toBe(ON_STATES.includes(name));
      expect(draw(Icon, { on: true }).classList.contains("icon-on"), name).toBe(true);
    }
  });

  it("passes an extra class through", () => {
    expect(draw(Icons.CheckIcon, { class: "extra" }).classList.contains("extra")).toBe(true);
  });

  it("keeps the brand mark outside the family", () => {
    const { container } = render(() => Icons.GoogleLogo());
    const svg = container.querySelector("svg")!;
    expect(svg.classList.contains("brand-mark")).toBe(true);
    expect(svg.classList.contains("icon")).toBe(false);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });
});
