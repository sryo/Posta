import { describe, it, expect, vi, beforeAll } from "vitest";

const { readFileSync } = await vi.importActual<{
  readFileSync(path: string, encoding: "utf8"): string;
}>("node:fs");

const srcDir = decodeURIComponent(import.meta.url.replace(/^file:\/\//, "").replace(/[^/]+$/, ""));

describe("App.css cascade", () => {
  beforeAll(() => {
    const style = document.createElement("style");
    style.textContent = readFileSync(srcDir + "App.css", "utf8");
    document.head.appendChild(style);
  });

  it("sizes code inside a preformatted block like the block itself", () => {
    document.body.innerHTML =
      '<div class="message-body"><pre id="pre"><code id="block">x</code></pre><p id="p"><code id="inline">y</code></p></div>';
    const size = (id: string) => getComputedStyle(document.getElementById(id)!).fontSize;
    expect(size("block")).toBe(size("pre"));
    expect(size("inline")).not.toBe(size("p"));
  });
});
