import { describe, expect, it } from "vitest";
import { signatureBlock, withSignature } from "./signature";

describe("signature", () => {
  it("adds nothing without a signature", () => {
    expect(withSignature("", null)).toBe("");
    expect(withSignature("\n\nquoted", "   ")).toBe("\n\nquoted");
  });

  it("starts a blank email with room to type above the delimiter", () => {
    expect(withSignature("", " Ana\nPosta ")).toBe("\n\n-- \nAna\nPosta");
  });

  it("goes above quoted text", () => {
    expect(withSignature("\n\nOn Mon, Bo wrote:\n> hi", "Ana")).toBe("\n\n-- \nAna\n\nOn Mon, Bo wrote:\n> hi");
    expect(withSignature("---------- Forwarded event ----------", "Ana")).toBe("\n\n-- \nAna\n\n---------- Forwarded event ----------");
  });

  it("recognises a body that is only the signature", () => {
    expect(signatureBlock("Ana")).toBe(withSignature("", "Ana"));
    expect(signatureBlock(null)).toBe("");
  });
});
