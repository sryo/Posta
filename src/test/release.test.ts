import { describe, it, expect } from "vitest";
import { readRepoFile } from "./files";

const workflow = readRepoFile(".github/workflows/release.yml");
const macOS = JSON.parse(readRepoFile("src-tauri/tauri.conf.json")).bundle.macOS as {
  signingIdentity?: string;
  entitlements?: string;
  files?: Record<string, string>;
};

// The text of the workflow step whose `name:` is `name`, up to the next step.
function step(name: string): string {
  const start = workflow.indexOf(`- name: ${name}`);
  if (start === -1) return "";
  const next = workflow.indexOf("\n      - ", start + 1);
  return workflow.slice(start, next === -1 ? undefined : next);
}

describe("release workflow", () => {
  it("hands the build the signing certificate and notarization login the macOS bundle needs", () => {
    expect(macOS.signingIdentity).toBeTruthy();
    const build = step("Build and release");
    for (const name of [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_ID",
      "APPLE_PASSWORD",
      "APPLE_TEAM_ID",
    ]) {
      expect(build).toMatch(new RegExp(`\\b${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`));
    }
  });

  it("stops a macOS release up front, by name, when a file the bundle embeds is missing", () => {
    const check = step("Check macOS bundle files");
    expect(check).toMatch(/if: matrix\.platform == 'macos-latest'/);
    const bundled = [...Object.values(macOS.files ?? {}), macOS.entitlements ?? ""].filter(Boolean);
    expect(bundled.length).toBeGreaterThan(1);
    for (const file of bundled) expect(check).toContain(`src-tauri/${file}`);
    expect(workflow.indexOf("- name: Check macOS bundle files")).toBeLessThan(
      workflow.indexOf("- name: Install frontend dependencies"),
    );
  });
});
