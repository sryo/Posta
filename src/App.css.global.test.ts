import { describe, expect, it } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";

const rules = parseRules(readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, ""));

// Declarations of the rules listing `selector`, in `context` ("" is top level)
function declarationsOf(selector: string, context = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of rules) {
    if (rule.context === context && rule.selectors.includes(selector)) {
      for (const [prop, value] of rule.declarations) out.set(prop, value);
    }
  }
  return out;
}

describe("dialogs", () => {
  it("let their scrolling bodies shrink inside the sheet, so a tall sheet scrolls instead of clipping", () => {
    expect(declarationsOf(".shortcuts-body").get("min-height")).toBe("0");
    expect(declarationsOf(".query-help-body").get("min-height")).toBe("0");
  });

  it("draw no focus ring on a dialog focused as a whole", () => {
    expect(declarationsOf('[role="dialog"][tabindex="-1"]:focus').get("outline")).toBe("none");
  });
});

describe("confirm dialog", () => {
  it("fills a destructive answer's button red", () => {
    const decl = declarationsOf(".confirm-dialog .btn-danger");
    expect(decl.get("background")).toBe("var(--danger)");
    expect(decl.get("color")).toBe("#fff");
  });
});

describe("toasts", () => {
  const DARK = "@media (prefers-color-scheme: dark)";

  it("take their colours from toast tokens", () => {
    expect(declarationsOf(".undo-toast").get("color")).toBe("var(--toast-text)");
    expect(declarationsOf(".toast-progress").get("background")).toBe("var(--toast-progress)");
    expect(declarationsOf(".toast-undo-btn").get("color")).toBe("var(--toast-action)");
    expect(declarationsOf(".toast-close-btn").get("color")).toBe("var(--toast-muted)");
  });

  it("are light in dark mode, so they stand out from the dark page", () => {
    const dark = declarationsOf(":root", DARK);
    const lightness = (hex: string) => parseInt(hex.slice(1, 3), 16);
    expect(lightness(dark.get("--toast-bg")!)).toBeGreaterThan(0xd0);
    expect(lightness(dark.get("--toast-text")!)).toBeLessThan(0x40);
  });

  it("hold their progress fill while paused", () => {
    expect(declarationsOf(".undo-toast.paused .toast-progress").get("animation-play-state")).toBe("paused");
  });
});
