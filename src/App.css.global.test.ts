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

describe("floating controls", () => {
  const DARK = "@media (prefers-color-scheme: dark)";

  it("sit on a raised surface in dark mode, lighter than the page", () => {
    expect(declarationsOf(":root", DARK).get("--bg-elevated")).toBe("#2c2c2c");
    expect(declarationsOf(":root").get("--bg-elevated")).toBeDefined();
    expect(declarationsOf(":root", DARK).get("--elevated-ring")).toBeDefined();
  });

  it("use it for the wheel buttons, the emoji picker and the autocomplete lists, ringed by a hairline", () => {
    const wheel = declarationsOf(".bulk-btn");
    expect(wheel.get("background")).toBe("var(--bg-elevated)");
    expect(wheel.get("color")).toBe("var(--text-secondary)");
    expect(wheel.get("box-shadow")).toContain("0 0 0 1px var(--elevated-ring)");
    for (const selector of [".emoji-picker", ".query-autocomplete", ".compose-autocomplete"]) {
      const decl = declarationsOf(selector);
      expect(decl.get("background"), selector).toBe("var(--bg-elevated)");
      expect(decl.get("border"), selector).toBe("1px solid var(--elevated-ring)");
    }
  });

  it("raise the thread's floating bar in dark mode too", () => {
    const bar = declarationsOf(".thread-floating-bar", DARK);
    expect(bar.get("background")).toContain("var(--bg-elevated)");
    expect(bar.get("box-shadow")).toContain("0 0 0 1px var(--elevated-ring)");
  });
});
