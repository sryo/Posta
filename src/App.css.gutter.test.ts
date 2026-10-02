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
  it("draws no perforations: the day strip under its words says where the stretch falls", () => {
    expect(declaration(".calendar-gutter", "background-image")).toBeUndefined();
    expect(declaration(".calendar-gutter", "--perforation")).toBeUndefined();
    expect(declaration(".calendar-gutter", "border-bottom")).toBe("1px solid var(--card-divider)");
  });

  it("sets its words smaller and quieter than an event's, the length across from them", () => {
    expect(declaration(".calendar-gutter-line", "font")).toBe("var(--type-meta)");
    expect(declaration(".calendar-gutter-line", "color")).toBe("var(--text-secondary)");
    expect(declaration(".calendar-gutter-length", "color")).toBe("var(--text-muted)");
    expect(declaration(".calendar-gutter", "font-variant-numeric")).toBe("tabular-nums");
    expect(declaration(".calendar-gutter-words", "justify-content")).toBe("space-between");
  });

  it("thins the strip to a hairline track, outlining the stretch in the card's ink", () => {
    expect(declaration('.day-strip[data-size="xs"] .day-strip-track', "height")).toBe("8px");
    expect(declaration('.day-strip[data-size="xs"] .day-strip-slot', "box-shadow")).toBe("inset 0 0 0 1.5px var(--card-ink)");
  });

  it("squares the stretch's right end when it runs to the end of the day", () => {
    expect(declaration('.calendar-gutter.ending .day-strip-slot', "border-top-right-radius")).toBe("0");
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
