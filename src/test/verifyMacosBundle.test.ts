import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readRepoFile } from "./files";

// Imported through importActual with inline types because @types/node is not
// a dependency.
const fs = await vi.importActual<{
  mkdtempSync(prefix: string): string;
  mkdirSync(path: string, options: { recursive: true }): void;
  writeFileSync(path: string, data: string, options?: { mode: number }): void;
  rmSync(path: string, options: { recursive: true; force: true }): void;
  existsSync(path: string): boolean;
}>("node:fs");
const { tmpdir, platform } = await vi.importActual<{ tmpdir(): string; platform(): string }>("node:os");
const { spawnSync } = await vi.importActual<{
  spawnSync(
    command: string,
    args: string[],
    options: { encoding: "utf8"; env: Record<string, string | undefined> },
  ): { status: number | null; stdout: string; stderr: string };
}>("node:child_process");
const { join, resolve } = await vi.importActual<{
  join(...paths: string[]): string;
  resolve(...paths: string[]): string;
}>("node:path");
declare const process: { env: Record<string, string | undefined>; cwd(): string };

const SCRIPT = resolve(process.cwd(), "scripts/verify-macos-bundle.sh");
const TEAM = "CL6XWJCS9R";
const APP_ID = `${TEAM}.com.posta.app`;
const KVSTORE = "com.apple.developer.ubiquity-kvstore-identifier";

const canRun = platform() === "darwin" && fs.existsSync("/usr/libexec/PlistBuddy");

function plist(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${body}
</plist>
`;
}

function dict(entries: Record<string, string>): string {
  return `<dict>${Object.entries(entries)
    .map(([k, v]) => `<key>${k}</key><string>${v}</string>`)
    .join("")}</dict>`;
}

const ENTITLEMENTS = {
  "com.apple.application-identifier": APP_ID,
  "com.apple.developer.team-identifier": TEAM,
  [KVSTORE]: APP_ID,
};

function profile(team: string, entitlements: Record<string, string>): string {
  return plist(
    `<dict><key>TeamIdentifier</key><array><string>${team}</string></array><key>Entitlements</key>${dict(entitlements)}</dict>`,
  );
}

let dir: string;
let app: string;

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), "posta-verify-"));
  app = join(dir, "Posta.app");
  fs.mkdirSync(join(app, "Contents"), { recursive: true });
  fs.mkdirSync(join(dir, "bin"), { recursive: true });
  // Stand-ins for codesign and security that print the fixtures below.
  fs.writeFileSync(
    join(dir, "bin", "codesign"),
    `#!/bin/sh\nif [ "$1" = --verify ]; then exit "\${STUB_VERIFY_STATUS:-0}"; fi\ncat "${dir}/signed.plist"\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(join(dir, "bin", "security"), `#!/bin/sh\ncat "${dir}/profile.plist"\n`, {
    mode: 0o755,
  });
  fs.writeFileSync(join(dir, "expected.plist"), plist(dict(ENTITLEMENTS)));
  fs.writeFileSync(join(dir, "signed.plist"), plist(dict(ENTITLEMENTS)));
  fs.writeFileSync(join(dir, "profile.plist"), profile(TEAM, ENTITLEMENTS));
  fs.writeFileSync(join(app, "Contents", "embedded.provisionprofile"), "signed blob");
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function verify(env: Record<string, string> = {}, args = [app, join(dir, "expected.plist")]) {
  const result = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, ...env },
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe.skipIf(!canRun)("verify-macos-bundle.sh", () => {
  it("passes a bundle signed with every entitlement and a profile that grants them", () => {
    const { status, output } = verify();
    expect(output).toBe("");
    expect(status).toBe(0);
  });

  it("fails when the signature is missing the iCloud key-value store entitlement", () => {
    const { [KVSTORE]: _dropped, ...rest } = ENTITLEMENTS;
    fs.writeFileSync(join(dir, "signed.plist"), plist(dict(rest)));
    const { status, output } = verify();
    expect(status).not.toBe(0);
    expect(output).toContain(KVSTORE);
  });

  it("fails when a signed entitlement differs from Entitlements.plist", () => {
    fs.writeFileSync(join(dir, "signed.plist"), plist(dict({ ...ENTITLEMENTS, [KVSTORE]: "OTHER.com.posta.app" })));
    const { status, output } = verify();
    expect(status).not.toBe(0);
    expect(output).toContain("OTHER.com.posta.app");
  });

  it("checks every entitlement Entitlements.plist lists, not just the last", () => {
    fs.writeFileSync(
      join(dir, "signed.plist"),
      plist(dict({ ...ENTITLEMENTS, "com.apple.application-identifier": "OTHER.com.posta.app" })),
    );
    const { status, output } = verify();
    expect(status).not.toBe(0);
    expect(output).toContain("com.apple.application-identifier='OTHER.com.posta.app'");
  });

  it("reads the repo's Entitlements.plist when none is given", () => {
    const repoEntitlements = readRepoFile("src-tauri/Entitlements.plist");
    fs.writeFileSync(join(dir, "signed.plist"), repoEntitlements);
    expect(verify({}, [app])).toEqual({ status: 0, output: "" });
    fs.writeFileSync(join(dir, "signed.plist"), plist(dict({})));
    expect(verify({}, [app]).status).not.toBe(0);
  });

  it("fails when codesign rejects the signature", () => {
    const { status, output } = verify({ STUB_VERIFY_STATUS: "1" });
    expect(status).not.toBe(0);
    expect(output).toMatch(/codesign --verify/);
  });

  it("fails when the bundle embeds no provisioning profile", () => {
    fs.rmSync(join(app, "Contents", "embedded.provisionprofile"), { recursive: true, force: true });
    const { status, output } = verify();
    expect(status).not.toBe(0);
    expect(output).toContain("embedded.provisionprofile");
  });

  it("fails when the profile does not grant the key-value store", () => {
    const { [KVSTORE]: _dropped, ...rest } = ENTITLEMENTS;
    fs.writeFileSync(join(dir, "profile.plist"), profile(TEAM, rest));
    const { status, output } = verify();
    expect(status).not.toBe(0);
    expect(output).toContain(KVSTORE);
  });

  it("fails when the profile belongs to another team", () => {
    fs.writeFileSync(join(dir, "profile.plist"), profile("ZZZZZZZZZZ", ENTITLEMENTS));
    const { status, output } = verify();
    expect(status).not.toBe(0);
    expect(output).toContain("ZZZZZZZZZZ");
  });

  it("accepts a profile that grants the team's wildcard identifier", () => {
    fs.writeFileSync(
      join(dir, "profile.plist"),
      profile(TEAM, { ...ENTITLEMENTS, [KVSTORE]: `${TEAM}.*`, "com.apple.application-identifier": `${TEAM}.*` }),
    );
    const { status, output } = verify();
    expect(output).toBe("");
    expect(status).toBe(0);
  });
});

describe("release workflow", () => {
  it("checks the built macOS app's signature, entitlements and profile after building it", () => {
    const workflow = readRepoFile(".github/workflows/release.yml");
    const build = workflow.indexOf("- name: Build and release");
    const check = workflow.indexOf("- name: Verify macOS bundle");
    expect(check).toBeGreaterThan(build);
    const step = workflow.slice(check);
    expect(step).toMatch(/if: matrix\.platform == 'macos-latest'/);
    expect(step).toContain(
      "scripts/verify-macos-bundle.sh src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Posta.app",
    );
  });
});
