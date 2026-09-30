import { describe, it, expect } from "vitest";
import { parseRules } from "../test/css";
import { readRepoFile } from "../test/files";

const rules = parseRules(readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, ""));

function declarations(selector: string): Map<string, string> {
  return new Map(rules.filter(rule => rule.selectors.includes(selector) && !rule.context).flatMap(rule => rule.declarations));
}

describe("invite row styles", () => {
  it("opens the answer menu in the dropdown layer, fixed to the window, since cards clip their rows", () => {
    const menu = declarations(".invite-answer-menu");
    expect(menu.get("position")).toBe("fixed");
    expect(menu.get("z-index")).toBe("var(--z-dropdown)");
  });

  it("writes the event's time plainly, muted once past and struck through when not going", () => {
    expect(declarations(".invite-when").get("color")).toBe("var(--text-primary)");
    expect(declarations(".invite-when.past").get("color")).toBe("var(--text-muted)");
    expect(declarations(".invite-when.struck").get("text-decoration")).toBe("line-through");
  });

  it("colours the answer by its status token, going quietly", () => {
    expect(declarations(".invite-answer.accepted").get("color")).toBe("var(--text-secondary)");
    expect(declarations(".invite-answer.tentative").get("color")).toBe("var(--warning-text)");
    expect(declarations(".invite-answer-item.accepted .invite-answer-icon").get("color")).toBe("var(--success-text)");
    expect(declarations(".invite-answer-item.tentative .invite-answer-icon").get("color")).toBe("var(--warning-text)");
    expect(declarations(".invite-answer-item.declined .invite-answer-icon").get("color")).toBe("var(--danger-text)");
  });

  it("keeps the event's time clear of the row's checkbox on hover and focus", () => {
    expect(declarations(".thread:is(:hover, .selected, .focused) .thread-row").get("padding-right")).toBe("24px");
  });

  it("lets a long clash shrink to an ellipsis beside the place, which keeps its icon and a few letters", () => {
    const clash = declarations(".invite-clash");
    expect(clash.get("min-width")).toBe("0");
    expect(clash.get("flex-shrink")).not.toBe("0");
    expect(clash.get("display")).toBe("inline-flex");
    const title = declarations(".invite-clash-title");
    expect(title.get("overflow")).toBe("hidden");
    expect(title.get("text-overflow")).toBe("ellipsis");
    expect(title.get("white-space")).toBe("nowrap");
    expect(declarations(".invite-place").get("min-width")).toBe("calc(var(--icon-meta) + var(--icon-gap-meta) + 4ch)");
  });

  it("hatches an overlapping event amber on the day strip", () => {
    expect(declarations(".invite-strip-busy.overlap").get("box-shadow")).toContain("var(--warning)");
  });
});
