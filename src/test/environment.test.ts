import { describe, it, expect } from "vitest";

describe("test environments", () => {
  it("runs suites that need no DOM without building one", () => {
    expect(typeof document).toBe("undefined");
  });
});
