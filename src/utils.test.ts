import { describe, expect, it } from "vitest";
import {
  addForwardPrefix,
  addReplyPrefix,
  extractEmail,
  extractName,
  splitEmailList,
  truncateMiddle,
  validateEmailList,
} from "./utils";

describe("subject prefixes", () => {
  it("adds Re: only when missing", () => {
    expect(addReplyPrefix("Hello")).toBe("Re: Hello");
    expect(addReplyPrefix("RE: Hello")).toBe("RE: Hello");
  });

  it("treats Fw: and Fwd: as already forwarded", () => {
    expect(addForwardPrefix("Hello")).toBe("Fwd: Hello");
    expect(addForwardPrefix("FW: Hello")).toBe("FW: Hello");
    expect(addForwardPrefix("fwd: Hello")).toBe("fwd: Hello");
  });
});

describe("address parsing", () => {
  it("extracts address and display name", () => {
    expect(extractEmail('"Doe, John" <jd@example.com>')).toBe("jd@example.com");
    expect(extractName('"Doe, John" <jd@example.com>')).toBe("Doe, John");
    expect(extractName("plain@example.com")).toBeUndefined();
  });

  it("does not split on commas inside quoted names", () => {
    expect(splitEmailList('"Doe, John" <jd@example.com>, x@example.com')).toEqual([
      '"Doe, John" <jd@example.com>',
      "x@example.com",
    ]);
  });

  it("reports only the invalid entries", () => {
    expect(validateEmailList("a@example.com, nope, B <b@example.com>")).toEqual({
      valid: false,
      invalidEmails: ["nope"],
    });
    expect(validateEmailList("   ")).toEqual({ valid: true, invalidEmails: [] });
  });
});

describe("truncateMiddle", () => {
  it("keeps the extension", () => {
    expect(truncateMiddle("quarterly-report.pdf", 12)).toBe("quarte...pdf");
    expect(truncateMiddle("short.pdf", 12)).toBe("short.pdf");
  });
});
