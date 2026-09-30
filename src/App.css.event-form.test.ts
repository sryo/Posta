import { describe, it, expect } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";

const css = readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);

const decls = (selector: string) =>
  new Map(rules.filter(r => !r.context && r.selectors.includes(selector)).flatMap(r => r.declarations));

describe("event form layout", () => {
  it("lets the timeline take a drag without scrolling or selecting text", () => {
    const track = decls(".day-timeline-track");
    expect(track.get("touch-action")).toBe("none");
    expect(track.get("user-select")).toBe("none");
  });

  it("sets the title as a heading", () => {
    expect(decls(".form-title-field").get("font")).toBe("var(--type-heading)");
  });

  it("floats the card wheel's scope menu over the board", () => {
    const prompt = decls(".scope-prompt");
    expect(prompt.get("position")).toBe("fixed");
    expect(prompt.get("z-index")).toBe("var(--z-modal)");
    expect(decls(".scope-prompt .scope-menu").get("position")).toBe("static");
  });

  it("keeps the scope menu its own width inside an inline edit, whose children are held to the column", () => {
    const shrink = decls(".message-row.with-compose .inline-compose *");
    expect(shrink.get("min-width")).toBe("0 !important");
    const menu = decls(".message-row.with-compose .inline-compose .scope-menu");
    expect(menu.get("min-width")).toBe("200px !important");
    expect(menu.get("max-width")).toBe("none");
  });

  it("keeps Cancel and Save in view", () => {
    const footer = decls(".event-form-footer");
    expect(footer.get("position")).toBe("sticky");
    expect(footer.get("bottom")).toBe("0");
  });
});
