import { describe, it, expect } from "vitest";
import { parseRules } from "./css";

describe("parseRules", () => {
  it("keeps a :not() argument list inside its selector", () => {
    const [rule] = parseRules("*:not(.a, .b .c), *::before { color: red }");
    expect(rule.selectors).toEqual(["*:not(.a, .b .c)", "*::before"]);
  });

  it("records the at-rule a nested style rule sits in", () => {
    const [rule] = parseRules("@media (prefers-reduced-motion: reduce) { .a, .b { opacity: 0 } }");
    expect(rule).toEqual({
      selectors: [".a", ".b"],
      declarations: [["opacity", "0"]],
      context: "@media (prefers-reduced-motion: reduce)",
    });
  });
});
