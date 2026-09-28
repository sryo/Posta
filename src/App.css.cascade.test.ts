import { describe, it, expect, beforeAll } from "vitest";
import { cascadedDeclarations, parseRules } from "./test/css";
import { readRepoFile } from "./test/files";

const css = readRepoFile("src/App.css");
const rules = parseRules(css.replace(/\/\*[\s\S]*?\*\//g, ""));

describe("App.css cascade", () => {
  beforeAll(() => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  });

  it("sizes code inside a preformatted block like the block itself", () => {
    document.body.innerHTML =
      '<div class="message-body"><pre id="pre"><code id="block">x</code></pre><p id="p"><code id="inline">y</code></p></div>';
    const size = (id: string) => getComputedStyle(document.getElementById(id)!).fontSize;
    expect(size("block")).toBe(size("pre"));
    expect(size("inline")).not.toBe(size("p"));
  });

  it("gives code inside a preformatted block no chip padding or background of its own", () => {
    document.body.innerHTML =
      '<div class="message-body"><pre><code id="block">x</code></pre><p><code id="inline">y</code></p></div>';
    const decl = (id: string) => cascadedDeclarations(rules, document.getElementById(id)!);
    expect(decl("inline").get("padding")).toBe("var(--space-xs) var(--space-md)");
    expect(decl("inline").get("background")).toBe("var(--bg-hover)");
    expect(decl("block").get("padding")).toBe("0");
    expect(decl("block").get("background")).toBe("none");
  });
});
