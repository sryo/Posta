import { describe, expect, it } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";

const raw = readRepoFile("src/App.css");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = parseRules(css);

function declaration(selector: string, prop: string, context = ""): string | undefined {
  const rule = rules.find(r => r.selectors.includes(selector) && r.context === context && r.declarations.some(([p]) => p === prop));
  return rule?.declarations.find(([p]) => p === prop)?.[1];
}

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

describe("a reply that becomes the message", () => {
  it("folds a part to nothing", () => {
    for (const [prop, value] of [["height", "0"], ["min-height", "0"], ["padding-top", "0"], ["padding-bottom", "0"], ["margin-top", "0"], ["margin-bottom", "0"], ["border-block-width", "0"], ["overflow", "hidden"], ["opacity", "0"]]) {
      expect(declaration("[data-folded]", prop), prop).toBe(value);
    }
  });

  it("trades the compose box's 1px border for a message's 2px ring and rounder corners, over 260ms", () => {
    expect(declaration(".inline-compose.sent", "border-color")).toBe("transparent");
    expect(declaration(".inline-compose.sent", "box-shadow")).toBe("0 0 0 2px var(--border-default)");
    expect(declaration(".inline-compose.sent", "border-radius")).toBe("var(--radius-xl)");
    expect(declaration(".inline-compose", "transition")).toBe(`border-color 260ms ${EASE}, box-shadow 260ms ${EASE}, border-radius 260ms ${EASE}`);
  });

  it("holds the words at 62% until they went, sized to the words, with the fields' gaps closed", () => {
    expect(declaration(".inline-compose.sent textarea", "opacity")).toBe("0.62");
    expect(declaration(".inline-compose.sent .compose-content", "min-height")).toBe("0");
    expect(declaration(".inline-compose.sent .compose-content textarea", "min-height")).toBe("0");
    expect(declaration(".inline-compose.sent .compose-body", "gap")).toBe("0");
  });

  it("runs a bar out over the undo window, and fades in what it says", () => {
    expect(declaration(".sent-undo-bar", "animation")).toBe("sent-undo-run linear both");
    expect(css).toMatch(/@keyframes sent-undo-run\s*{\s*from\s*{\s*transform: scaleX\(1\);?\s*}\s*to\s*{\s*transform: scaleX\(0\);?\s*}/);
    expect(declaration(".sent-when", "animation")).toBe("sent-when-in 200ms linear");
  });

  it("keeps the undo bar running under reduced motion, since it says how long Undo lasts", () => {
    const killSwitch = rules.find(r => r.context === "@media (prefers-reduced-motion: reduce)" && r.declarations.some(([p, v]) => p === "animation-duration" && v.includes("0.01ms")));
    expect(killSwitch?.selectors[0]).toMatch(/^\*:not\(.*\.sent-undo-bar.*\)$/);
  });
});
