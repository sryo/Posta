import { describe, expect, it } from "vitest";
import { fingerprint } from "./fingerprint";

describe("fingerprint", () => {
  it("is the same for the same text and short however long the text", () => {
    const big = "x".repeat(2_000_000);
    expect(fingerprint(big)).toBe(fingerprint("x".repeat(2_000_000)));
    expect(fingerprint(big).length).toBeLessThan(20);
  });

  it("differs when one character changes, anywhere", () => {
    const base = `[${"a".repeat(1000)}]`;
    const seen = new Set([fingerprint(base)]);
    for (const at of [1, 500, 1000]) {
      seen.add(fingerprint(base.slice(0, at) + "b" + base.slice(at + 1)));
    }
    seen.add(fingerprint(base + " "));
    expect(seen.size).toBe(5);
  });
});
