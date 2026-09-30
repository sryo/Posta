import { describe, expect, it } from "vitest";
import { parseRules } from "./test/css";
import { readRepoFile } from "./test/files";
import { contrast, over, resolveColor, tokenScope, type RGBA, type Theme } from "./test/color";

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

  it("keep a shortcut's keys on one line however long its description", () => {
    const key = declarationsOf(".key-hint.key");
    expect(key.get("white-space")).toBe("nowrap");
    expect(key.get("flex-shrink")).toBe("0");
  });

  it("draw no focus ring on a dialog focused as a whole", () => {
    expect(declarationsOf('[role="dialog"][tabindex="-1"]:focus').get("outline")).toBe("none");
  });
});

describe("form parts", () => {
  it("lay a form footer out as leading controls, a status taking the room left, and the buttons", () => {
    expect(declarationsOf(".form-footer").get("display")).toBe("flex");
    expect(declarationsOf(".form-footer-status").get("flex")).toBe("1");
    expect(declarationsOf(".form-footer-actions").get("display")).toBe("flex");
    expect(declarationsOf(".form-footer-actions").get("gap")).toBe("var(--space-md)");
  });

  it("draw a title field as a borderless heading", () => {
    const decl = declarationsOf(".form-title-field");
    expect(decl.get("font")).toBe("var(--type-heading)");
    expect(decl.get("border")).toBe("none");
  });

  it("give every field row's label the same width", () => {
    expect(declarationsOf(".form-field-row label").get("min-width")).toBe("64px");
  });
});

describe("buttons", () => {
  it("fade a disabled primary button in its own colour, so it can't pass for an enabled grey one", () => {
    const decl = declarationsOf(".btn-primary:disabled");
    expect(decl.get("background")).toBe("var(--accent-fill)");
    expect(decl.get("border-color")).toBe("var(--accent-fill)");
    expect(decl.get("opacity")).toBe("0.4");
  });
});

const color = (theme: Theme, name: string): RGBA => resolveColor(`var(${name})`, tokenScope(rules, theme));
// Relative lightness of an opaque colour, for ordering surfaces
const lightness = ([r, g, b]: RGBA) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe("confirm dialog", () => {
  it("fills a destructive answer's button red", () => {
    const decl = declarationsOf(".confirm-dialog .btn-danger");
    expect(decl.get("background")).toBe("var(--danger)");
    expect(decl.get("color")).toBe("var(--text-on-status)");
  });

  it("keeps the red button's label readable in light and dark mode", () => {
    for (const theme of ["light", "dark"] as const) {
      expect(contrast(color(theme, "--text-on-status"), color(theme, "--danger")), theme).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("toasts", () => {
  it("take their colours from the inverse tokens", () => {
    expect(declarationsOf(".undo-toast").get("background")).toBe("var(--surface-inverse)");
    expect(declarationsOf(".undo-toast").get("color")).toBe("var(--text-inverse)");
    expect(declarationsOf(".toast-progress").get("background")).toBe("var(--surface-inverse-hover)");
    expect(declarationsOf(".toast-undo-btn").get("color")).toBe("var(--text-link-inverse)");
    expect(declarationsOf(".icon-btn[data-tone=\"inverse\"]").get("color")).toBe("var(--text-inverse-muted)");
  });

  it("are light in dark mode, so they stand out from the dark page", () => {
    expect(lightness(color("dark", "--surface-inverse"))).toBeGreaterThan(0.8);
    expect(lightness(color("dark", "--text-inverse"))).toBeLessThan(0.25);
  });

  it("keep their text and close button readable in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const toast = color(theme, "--surface-inverse");
      expect(contrast(color(theme, "--text-inverse"), toast), theme).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color(theme, "--text-inverse-muted"), toast), theme).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keep the Undo link vivid, at 4:1 or better on either toast", () => {
    // Accent set as text on a light surface is the vivid ink where it holds
    // 4.5:1 and a deeper step where it doesn't; the light toast of dark mode
    // takes accent-600, which holds 4:1
    for (const theme of ["light", "dark"] as const) {
      expect(contrast(color(theme, "--text-link-inverse"), color(theme, "--surface-inverse")), theme).toBeGreaterThanOrEqual(4);
    }
  });

  it("hold their progress fill while paused", () => {
    expect(declarationsOf(".undo-toast.paused .toast-progress").get("animation-play-state")).toBe("paused");
  });

  it("raise an error above a toast already showing, clear of it", () => {
    expect(declarationsOf(".undo-toast").get("bottom")).toBe("24px");
    expect(declarationsOf(".undo-toast.raised").get("bottom")).toBe("calc(24px + var(--toast-row))");
    expect(declarationsOf(":root").get("--toast-row")).toBeDefined();
  });
});

describe("floating controls", () => {
  it("sit on a raised surface in dark mode, lighter than the cards and the page", () => {
    const [raised, card, page] = ["--surface-raised", "--surface-card", "--surface-app"].map((name) => lightness(color("dark", name)));
    expect(raised).toBeGreaterThan(card);
    expect(card).toBeGreaterThan(page);
  });

  it("use it for the wheel buttons, the emoji picker and the autocomplete lists, ringed by a hairline", () => {
    const wheel = declarationsOf(".radial-petal");
    expect(wheel.get("background")).toBe("var(--surface-raised)");
    expect(wheel.get("color")).toBe("var(--text-secondary)");
    expect(wheel.get("box-shadow")).toContain("0 0 0 1px var(--border-default)");
    for (const selector of [".emoji-picker", ".query-autocomplete", ".compose-autocomplete"]) {
      const decl = declarationsOf(selector);
      expect(decl.get("background"), selector).toBe("var(--surface-raised)");
      expect(decl.get("border"), selector).toBe("1px solid var(--border-default)");
    }
  });

  it("keep each query suggestion on one line, cutting a long address or name short", () => {
    for (const selector of [".query-autocomplete-op", ".query-autocomplete-desc"]) {
      const decl = declarationsOf(selector);
      expect(decl.get("white-space"), selector).toBe("nowrap");
      expect(decl.get("overflow"), selector).toBe("hidden");
      expect(decl.get("text-overflow"), selector).toBe("ellipsis");
      expect(decl.get("min-width"), selector).toBe("0");
    }
  });

  it("raise the thread's floating bar above the page in dark mode too", () => {
    expect(declarationsOf(".thread-floating-bar").get("background")).toBe("var(--surface-floating)");
    const page = color("dark", "--surface-app");
    expect(lightness(over(color("dark", "--surface-floating"), page))).toBeGreaterThan(lightness(color("dark", "--surface-card")));
  });
});
