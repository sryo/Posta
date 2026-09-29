import { describe, it, expect } from "vitest";
import { cascadedDeclarations, parseRules } from "./test/css";
import { readRepoFile } from "./test/files";

const rules = parseRules(readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, ""));

const rootTokens = new Map(
  rules.filter((r) => r.selectors.includes(":root") && r.context === "").flatMap((r) => r.declarations),
);

// Resolves a z-index made of :root tokens, numbers and `calc(a + b)`.
function zIndex(value: string | undefined): number {
  if (!value) return NaN;
  const resolved = value.replace(/var\((--[\w-]+)\)/g, (_, name) => rootTokens.get(name) ?? "NaN");
  const sum = resolved.replace(/^calc\((.*)\)$/, "$1").split("+").map((n) => Number(n.trim()));
  return sum.reduce((a, b) => a + b, 0);
}

describe("reading view stacking", () => {
  it("draws the emoji picker above the focused message's actions wheel", () => {
    document.body.innerHTML = `
      <div class="message-card">
        <div class="message-header"><div class="reaction-btn-container"><div class="emoji-picker" id="picker"></div></div></div>
        <div class="message-actions-wheel open" id="wheel"><button class="message-action-btn"></button></div>
      </div>`;
    const z = (id: string) => zIndex(cascadedDeclarations(rules, document.getElementById(id)!).get("z-index"));
    expect(z("picker")).toBeGreaterThan(z("wheel"));
  });
});

describe("floating emoji picker", () => {
  it("sits at its viewport position above the open thread and an inline reply", () => {
    document.body.innerHTML = '<div class="thread-overlay" id="thread"></div><div class="emoji-picker floating" id="picker"></div>';
    const picker = cascadedDeclarations(rules, document.getElementById("picker")!);
    expect(picker.get("position")).toBe("fixed");
    expect(picker.get("margin-top")).toBe("0");
    const z = (id: string) => zIndex(cascadedDeclarations(rules, document.getElementById(id)!).get("z-index"));
    expect(z("picker")).toBeGreaterThan(z("thread"));
  });
});

describe("thread beside a side panel", () => {
  it("moves over to clear the compose or event panel, as far as the window allows", () => {
    document.body.innerHTML = '<div class="app side-panel-open"><div class="thread-overlay" id="thread"></div></div>';
    // A border, not padding: the floating toolbar is positioned in the padding box
    const border = cascadedDeclarations(rules, document.getElementById("thread")!).get("border-left");
    expect(border).toMatch(/^clamp\(0px, .*, 528px\) solid var\(--app-bg, var\(--bg-primary\)\)$/);
  });
});

describe("attachment lightbox", () => {
  it("covers the thread view and the label drawer", () => {
    document.body.innerHTML = '<div class="thread-overlay" id="thread"></div><div class="label-drawer" id="drawer"></div><div class="lightbox" id="lightbox"></div>';
    const z = (id: string) => zIndex(cascadedDeclarations(rules, document.getElementById(id)!).get("z-index"));
    expect(z("lightbox")).toBeGreaterThan(z("thread"));
    expect(z("lightbox")).toBeGreaterThan(z("drawer"));
  });

  it("draws its close button light on the dark backdrop in either theme", () => {
    document.body.innerHTML = '<div class="lightbox"><button class="close-btn" id="close"></button></div>';
    const decl = cascadedDeclarations(rules, document.getElementById("close")!);
    expect(decl.get("color")).toBe("#fff");
    expect(decl.get("background")).toBe("rgba(255, 255, 255, 0.15)");
  });

  it("may show a PDF from a blob: URL in a frame, and nothing else from outside the app", () => {
    const csp: string = JSON.parse(readRepoFile("src-tauri/tauri.conf.json")).app.security.csp;
    const frameSrc = csp.split(";").map(d => d.trim()).find(d => d.startsWith("frame-src"));
    expect(frameSrc?.split(/\s+/).slice(1).sort()).toEqual(["'self'", "blob:"]);
  });
});

describe("thread toolbar", () => {
  it("shows a disabled button, such as Unsubscribed, as inert", () => {
    document.body.innerHTML = '<button class="thread-toolbar-btn" id="b" disabled></button>';
    const decl = cascadedDeclarations(rules, document.getElementById("b")!);
    expect(decl.get("cursor")).toBe("default");
    expect(decl.get("color")).toBe("var(--text-muted)");
  });
});

describe("message body", () => {
  it("drops the top margin of an email's opening paragraph inside MessageBody's own wrapper", () => {
    document.body.innerHTML = '<div class="message-body"><div><div dir="ltr"><div><p id="p">Hi</p></div></div></div></div>';
    expect(cascadedDeclarations(rules, document.getElementById("p")!).get("margin-top")).toBe("0");
  });

  it("marks the quoted-history toggle as open while the history shows", () => {
    document.body.innerHTML = '<button class="quoted-toggle" id="closed" aria-expanded="false"></button><button class="quoted-toggle" id="open" aria-expanded="true"></button>';
    const background = (id: string) => cascadedDeclarations(rules, document.getElementById(id)!).get("background");
    expect(background("closed")).toBe("var(--bg-hover)");
    expect(background("open")).toBe("var(--bg-tertiary)");
  });
});
