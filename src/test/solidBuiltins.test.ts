import { describe, it, expect } from "vitest";

const sources = Object.entries(
  import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx"], {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);

// Solid's compiler swaps these JSX tags for its own control flow in the app
// build, even where a file defines its own; the test build doesn't, so a
// local `Switch` passes every test and crashes in the app
const BUILT_INS = ["Switch", "Match", "For", "Show", "Index", "Portal", "Dynamic", "ErrorBoundary", "Suspense", "SuspenseList", "NoHydration"];

describe("components named like Solid's built-ins", () => {
  it("reads the components it checks", () => {
    expect(sources.some(([file]) => file.endsWith("/App.tsx"))).toBe(true);
  });

  it("defines none, so the app build can't swap them for Solid's", () => {
    const declaration = new RegExp(`^\\s*(?:export\\s+)?(?:function|const|let|class)\\s+(${BUILT_INS.join("|")})\\b`, "m");
    const offenders = sources.filter(([, source]) => declaration.test(source)).map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
