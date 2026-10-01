import { describe, expect, it } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";

const css = readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);

function declaration(selector: string, prop: string, context = ""): string | undefined {
  const rule = rules.find(r => r.selectors.includes(selector) && r.context === context && r.declarations.some(([p]) => p === prop));
  return rule?.declarations.find(([p]) => p === prop)?.[1];
}

describe("calendar gutter styles", () => {
  it("perforates the gutter above and below in a faint wash of the card's ink", () => {
    expect(declaration(".calendar-gutter", "--perforation")).toMatch(/^color-mix\(in srgb, var\(--card-ink\) \d+%, transparent\)$/);
    const image = declaration(".calendar-gutter", "background-image") ?? "";
    expect(image.match(/radial-gradient\(circle, var\(--perforation\)/g)).toHaveLength(2);
    expect(declaration(".calendar-gutter", "background-repeat")).toBe("repeat-x");
    expect(declaration(".calendar-gutter", "background-position")).toBe("3px -3px, 3px calc(100% + 3px)");
  });

  it("lets the perforations stand in for the divider of the row above", () => {
    expect(declaration(".calendar-event-item:has(+ .calendar-gutter)", "border-bottom")).toBe("none");
  });

  it("sets its words smaller and quieter than an event's", () => {
    expect(declaration(".calendar-gutter-line", "font")).toBe("var(--type-meta)");
    expect(declaration(".calendar-gutter-line", "color")).toBe("var(--text-secondary)");
    expect(declaration(".calendar-gutter-length", "color")).toBe("var(--text-muted)");
    expect(declaration(".calendar-gutter", "font-variant-numeric")).toBe("tabular-nums");
  });

  it("grows a little and centres its line at the end of the day", () => {
    expect(declaration(".calendar-gutter.ending", "justify-content")).toBe("center");
    expect(parseInt(declaration(".calendar-gutter.ending", "min-height") ?? "0")).toBeGreaterThan(parseInt(declaration(".calendar-gutter", "min-height") ?? "0"));
  });

  it("slides the now-mark in the card's ink, and holds it still when motion is reduced", () => {
    expect(declaration(".calendar-gutter-now", "background")).toBe("var(--card-ink)");
    expect(declaration(".calendar-gutter-now", "transition")).toMatch(/^left /);
    expect(declaration(".calendar-gutter-now", "transition", "@media (prefers-reduced-motion: reduce)")).toBe("none");
  });
});

describe("calendar day note styles", () => {
  it("sets the note as a quiet line in the gutter's type, with no perforations", () => {
    expect(declaration(".calendar-day-note", "font")).toBe("var(--type-meta)");
    expect(declaration(".calendar-day-note", "color")).toBe("var(--text-secondary)");
    expect(declaration(".calendar-day-note", "font-variant-numeric")).toBe("tabular-nums");
    expect(declaration(".calendar-day-note", "background-image")).toBeUndefined();
    expect(declaration(".calendar-day-note", "border-bottom")).toBe("1px solid var(--card-divider)");
  });
});
