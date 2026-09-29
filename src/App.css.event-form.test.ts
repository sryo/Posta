import { describe, it, expect } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";

const css = readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);

const decls = (selector: string) =>
  new Map(rules.filter(r => !r.context && r.selectors.includes(selector)).flatMap(r => r.declarations));

describe("event form layout", () => {
  it("keeps the title and calendar in view however far the form scrolls", () => {
    const header = decls(".event-form-header");
    expect(header.get("position")).toBe("sticky");
    expect(header.get("top")).toBe("0");
    expect(header.get("background")).toBe("var(--bg-primary)");
  });

  it("sets the title at 17px semibold", () => {
    const title = decls(".event-title-input");
    expect(title.get("font-size")).toBe("17px");
    expect(title.get("font-weight")).toBe("600");
  });

  it("keeps Cancel and Save in view", () => {
    const footer = decls(".event-form-footer");
    expect(footer.get("position")).toBe("sticky");
    expect(footer.get("bottom")).toBe("0");
  });
});
