import { vi } from "vitest";

// Imported through importActual with inline types because @types/node is not
// a dependency.
const { readFileSync } = await vi.importActual<{
  readFileSync(path: string, encoding: "utf8"): string;
}>("node:fs");
const { fileURLToPath } = await vi.importActual<{ fileURLToPath(url: string): string }>("node:url");
const { dirname, join } = await vi.importActual<{
  dirname(path: string): string;
  join(...paths: string[]): string;
}>("node:path");

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Reads a file by its slash-separated path from the repo root, with line
// endings normalised so a CRLF checkout parses the same.
export function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, ...path.split("/")), "utf8").replace(/\r\n/g, "\n");
}
