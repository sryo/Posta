import { describe, expect, it } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";

const css = readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);

function declaration(selector: string, prop: string, context = ""): string | undefined {
  const rule = rules.find(r => r.selectors.includes(selector) && r.context === context && r.declarations.some(([p]) => p === prop));
  return rule?.declarations.find(([p]) => p === prop)?.[1];
}

describe("everyone else declined", () => {
  it("says it muted, in the place line's type", () => {
    expect(declaration(".calendar-event-alone", "font")).toBe("var(--type-meta)");
    expect(declaration(".calendar-event-alone", "color")).toBe("var(--text-muted)");
    expect(declaration(".calendar-event-alone", "display")).toBe("flex");
  });

  it("sets the organizer's actions as quiet text buttons, cancelling in the danger ink", () => {
    expect(declaration(".calendar-event-alone-action", "background")).toBe("none");
    expect(declaration(".calendar-event-alone-action", "border")).toBe("none");
    expect(declaration(".calendar-event-alone-action", "font")).toBe("var(--type-meta)");
    expect(declaration(".calendar-event-alone-action", "color")).toBe("var(--text-link)");
    expect(declaration(".calendar-event-alone-action.danger", "color")).toBe("var(--danger-text)");
  });
});
