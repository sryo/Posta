import { describe, it, expect } from "vitest";
import { readRepoFile } from "../test/files";

// Tauri resolves commands by string name and maps camelCase invoke keys onto
// snake_case Rust parameters, so a renamed command or parameter only fails at
// runtime. These tests read both sides and compare them.

const rust = readRepoFile("src-tauri/src/commands.rs") + "\n" + readRepoFile("src-tauri/src/lib.rs");

const stripRustComments = (src: string) => src.replace(/\/\/[^\n]*/g, "");
const toCamel = (name: string) => name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
// Injected by Tauri rather than passed from the frontend
const INJECTED = /\b(State|AppHandle|Window|Webview|WebviewWindow)\b/;

function rustCommands(): Map<string, string[]> {
  const commands = new Map<string, string[]>();
  const src = stripRustComments(rust);
  const fnPattern = /#\[tauri::command\]\s*(?:pub(?:\(crate\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([\s\S]*?)\)\s*(?:->|\{)/g;
  for (const [, name, params] of src.matchAll(fnPattern)) {
    const args = params
      .split(/,(?![^<]*>)/)
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => {
        const colon = p.indexOf(":");
        return { name: p.slice(0, colon).trim().replace(/^mut\s+/, ""), type: p.slice(colon + 1) };
      })
      .filter(p => !INJECTED.test(p.type))
      .map(p => toCamel(p.name));
    commands.set(name, args);
  }
  return commands;
}

function registeredCommands(): Set<string> {
  const block = stripRustComments(rust).match(/generate_handler!\[([\s\S]*?)\]/);
  if (!block) return new Set();
  return new Set(block[1].split(",").map(s => s.trim().split("::").pop()!).filter(Boolean));
}

const sources = Object.entries(
  import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!../test/**"], {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);

type InvokeCall = { file: string; command: string; keys: string[] };

function invokeCalls(): InvokeCall[] {
  const calls: InvokeCall[] = [];
  const pattern = /\binvoke(?:<[^(]*>)?\(\s*["'](\w+)["']\s*(?:,\s*\{([^}]*)\})?\s*\)/g;
  for (const [file, src] of sources) {
    for (const [, command, body] of src.matchAll(pattern)) {
      const keys = (body ?? "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => s.split(":")[0].trim());
      calls.push({ file, command, keys });
    }
  }
  return calls;
}

describe("frontend ↔ Rust command contract", () => {
  const commands = rustCommands();
  const registered = registeredCommands();
  const calls = invokeCalls();

  it("finds the commands and the calls it compares", () => {
    expect(commands.size).toBeGreaterThan(30);
    expect(registered.size).toBeGreaterThan(30);
    expect(calls.length).toBeGreaterThan(30);
  });

  it("parses every invoke call, so none escapes the comparison", () => {
    const starts = sources.flatMap(([file, src]) =>
      Array.from(src.matchAll(/\binvoke(?:<[^(]*>)?\(\s*["'](\w+)["']/g), m => `${file}: ${m[1]}`));
    expect(calls.map(c => `${c.file}: ${c.command}`).sort()).toEqual(starts.sort());
  });

  it("registers every command the frontend invokes", () => {
    const missing = calls.filter(c => !registered.has(c.command) || !commands.has(c.command));
    expect(missing.map(c => `${c.file}: ${c.command}`)).toEqual([]);
  });

  it("passes exactly the arguments each command takes", () => {
    const mismatches = calls.flatMap(c => {
      const expected = commands.get(c.command);
      if (!expected) return [];
      const missing = expected.filter(k => !c.keys.includes(k));
      const extra = c.keys.filter(k => !expected.includes(k));
      return missing.length || extra.length ? [`${c.file}: ${c.command} missing [${missing}] extra [${extra}]`] : [];
    });
    expect(mismatches).toEqual([]);
  });

  it("parses multi-line parameters and skips injected state", () => {
    expect(commands.get("reply_to_thread")).toEqual([
      "accountId", "threadId", "to", "cc", "bcc", "subject", "body", "messageId", "attachments", "isHtml",
    ]);
    expect(commands.get("init_app")).toEqual([]);
  });
});
