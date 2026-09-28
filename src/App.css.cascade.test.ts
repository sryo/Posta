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

  it("floats the app's error banner below the window drag strip, on its own surface", () => {
    document.body.innerHTML =
      '<div class="app"><div class="drag-region"></div><div class="auth-error" id="banner">Oops<button class="btn">×</button></div></div>';
    const decl = cascadedDeclarations(rules, document.getElementById("banner")!);
    expect(decl.get("position")).toBe("fixed");
    // The drag strip sits above everything and swallows clicks in its band.
    expect(decl.get("top")).toMatch(/var\(--drag-region-height\)/);
    expect(decl.get("background")).toMatch(/^var\(--bg-/);
    expect(decl.get("display")).toMatch(/flex/);
    expect(decl.get("gap")).toBeDefined();
  });

  it("spaces a settings section's intro hint from its fields, and widens its submit button", () => {
    document.body.innerHTML = `<div class="settings-section">
        <div class="settings-section-title">Google API</div>
        <p class="settings-hint" id="intro">Intro</p>
        <div class="settings-form-group"></div>
        <p class="settings-hint" id="note">Note</p>
        <button class="btn btn-primary" id="submit">Connect</button>
      </div>`;
    const decl = (id: string) => cascadedDeclarations(rules, document.getElementById(id)!);
    expect(decl("intro").get("margin-bottom")).toBe("var(--space-lg)");
    expect(decl("note").get("margin-bottom")).toBeUndefined();
    expect(decl("submit").get("width")).toBe("100%");
    expect(decl("submit").get("margin-top")).toBe("var(--space-lg)");
  });
});
