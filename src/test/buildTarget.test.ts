import { describe, it, expect } from "vitest";
import viteConfig from "../../vite.config";
import { readRepoFile } from "./files";

// The newest Safari, and so the newest WKWebView, each macOS release can run.
const NEWEST_SAFARI_BY_MACOS: Record<string, number> = {
  "10.15": 15.6,
  "11": 16.6,
  "12": 17.6,
  "13": 18.6,
};

const minimumSystemVersion: string = JSON.parse(readRepoFile("src-tauri/tauri.conf.json")).bundle
  .macOS.minimumSystemVersion;

describe("production build target", () => {
  it("emits syntax the WebKit of the oldest supported macOS can parse", () => {
    const ceiling = NEWEST_SAFARI_BY_MACOS[minimumSystemVersion.replace(/\.0$/, "")];
    expect(ceiling, `no Safari ceiling recorded for macOS ${minimumSystemVersion}`).toBeDefined();
    const target = viteConfig.build?.target;
    const targets = (Array.isArray(target) ? target : [target]).filter(
      (t): t is string => typeof t === "string",
    );
    const safari = targets.map((t) => /^safari(\d+(?:\.\d+)?)$/.exec(t)).filter((m) => m !== null);
    expect(safari.length, `build.target ${JSON.stringify(target)} names no Safari version`).toBeGreaterThan(0);
    for (const m of safari) expect(Number(m[1])).toBeLessThanOrEqual(ceiling);
  });
});
