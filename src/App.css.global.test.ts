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
