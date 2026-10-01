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

describe("a view opened from its row", () => {
  it("leaves the slide out while it grows from and shrinks into the row", () => {
    expect(declaration(".thread-overlay.via-row", "animation")).toBe("none");
    expect(declaration(".thread-overlay.via-row.closing", "animation")).toBe("none");
  });

  it("lights the row it goes back to in the accent tint, fading over 1100ms", () => {
    expect(declaration(".thread[data-returned]", "animation")).toBe("row-return 1100ms ease-out");
    expect(declaration(".calendar-event-item[data-returned]", "animation")).toBe("row-return 1100ms ease-out");
    expect(css).toMatch(/@keyframes row-return\s*{\s*from\s*{\s*box-shadow: inset 0 0 0 100vmax var\(--accent-tint\);?\s*}/);
  });

  it("keeps the light under reduced motion, since it says where you are", () => {
    const killSwitch = rules.find(r => r.context === "@media (prefers-reduced-motion: reduce)" && r.declarations.some(([p, v]) => p === "animation-duration" && v.includes("0.01ms")));
    expect(killSwitch?.selectors[0]).toMatch(/^\*:not\(.*\[data-returned\].*\)$/);
  });
});
