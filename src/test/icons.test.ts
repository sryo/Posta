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
  "/components/TransitGap.tsx": "the handstamp between two letters of a thread long apart",
};

// Unicode standing in for a drawn icon. Key labels (⌘ ⇧ ↵) and the · separator are text.
const GLYPH_ICON = /[⚠✓✔✕✖×•↗📎📄🖼]/u;

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

  it("recognises a glyph standing in for an icon", () => {
    for (const text of ["⚠ Design review", "✓ Going", ">•••</button>", "Google Calendar ↗", "'📎'", "'🖼️'", ">×</button>"]) {
      expect(GLYPH_ICON.test(text), text).toBe(true);
    }
    for (const text of ["<kbd>⌘</kbd>", "⇧M", "↵ to send", "15 m · Studio 2", "→"]) {
      expect(GLYPH_ICON.test(text), text).toBe(false);
    }
  });

  it("sets no unicode glyph as an icon in a component", () => {
    const offenders = sources.flatMap(([file, source]) =>
      withoutComments(source)
        .split("\n")
        .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
        .filter(({ line }) => GLYPH_ICON.test(line))
        .map(({ at, line }) => `${at}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});

type Size = "meta" | "ui" | "tool";
type IconComponent = (props?: { size?: Size; strong?: boolean; class?: string }) => JSX.Element;

const icons = Object.entries(Icons).filter(([name]) => name.endsWith("Icon")) as [string, IconComponent][];
const SIZES: Size[] = ["meta", "ui", "tool"];
// Stroke in 16-grid units at each size; strong adds 0.25
const STROKE: Record<Size, number> = { meta: 1.6, ui: 1.45, tool: 1.35 };
// The icons with an active version, which fill their body
const FILLED = ["StarFilledIcon", "ThumbsUpFilledIcon"];

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

  it("draws every line at one weight, stepping with the size and in strong text", () => {
    for (const [name, Icon] of icons) {
      for (const size of SIZES) {
        for (const strong of [false, true]) {
          const svg = draw(Icon, { size, strong });
          expect(Number(svg.getAttribute("stroke-width")), `${name} ${size}`).toBeCloseTo(STROKE[size] + (strong ? 0.25 : 0), 5);
          expect(svg.querySelectorAll("[stroke-width]:not(svg)").length, `${name} ${size} detail`).toBe(0);
        }
      }
    }
  });

  it("fills solid details with currentColor only", () => {
    for (const [name, Icon] of icons) {
      for (const el of draw(Icon).querySelectorAll("[fill]:not(svg)")) {
        expect(el.getAttribute("fill"), name).toBe("currentColor");
      }
    }
  });

  it("fills a body only on an icon's active version, under its outline", () => {
    for (const [name, Icon] of icons) {
      const svg = draw(Icon);
      const body = svg.querySelector(':scope > g[fill="currentColor"]');
      expect(body !== null, name).toBe(FILLED.includes(name));
      if (body) expect(svg.firstElementChild, name).toBe(body);
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
