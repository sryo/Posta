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

  it("writes the event's time in the accent, muted once past and struck through when not going", () => {
    expect(declarations(".invite-when").get("color")).toBe("var(--accent)");
    expect(declarations(".invite-when.past").get("color")).toBe("var(--text-muted)");
    expect(declarations(".invite-when.struck").get("text-decoration")).toBe("line-through");
  });

  it("colours the answer by its status token", () => {
    expect(declarations(".invite-answer.accepted").get("color")).toBe("var(--success-fg)");
    expect(declarations(".invite-answer.tentative").get("color")).toBe("var(--warning-fg)");
    expect(declarations(".invite-answer-item.accepted .invite-answer-dot").get("background")).toBe("var(--success)");
    expect(declarations(".invite-answer-item.tentative .invite-answer-dot").get("background")).toBe("var(--warning)");
    expect(declarations(".invite-answer-item.declined .invite-answer-dot").get("background")).toBe("var(--danger)");
  });

  it("keeps the event's time clear of the row's checkbox on hover and focus", () => {
    expect(declarations(".thread.invite:is(:hover, .focused, .selected) .thread-row").get("padding-right")).toBe("24px");
  });

  it("hatches an overlapping event amber on the day strip", () => {
    expect(declarations(".invite-strip-busy.overlap").get("box-shadow")).toContain("var(--warning)");
  });
});
