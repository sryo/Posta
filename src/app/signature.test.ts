import { describe, expect, it } from "vitest";
import { signatureBlock, swapSignature, withSignature } from "./signature";

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

  it("swaps one account's signature for another's where it stands", () => {
    expect(swapSignature("Hi Bo\n\n-- \nAna\n\n> quoted", "Ana", "Ana Work")).toBe("Hi Bo\n\n-- \nAna Work\n\n> quoted");
    expect(swapSignature(withSignature("", "Ana"), "Ana", null)).toBe("");
    expect(swapSignature("", null, "Ana")).toBe(withSignature("", "Ana"));
    expect(swapSignature("\n\nOn Mon, Bo wrote:", null, "Ana")).toBe(withSignature("\n\nOn Mon, Bo wrote:", "Ana"));
  });

  it("leaves a signature the user edited as it is", () => {
    expect(swapSignature("Hi\n\n-- \nAna, typed over", "Ana", "Bo")).toBe("Hi\n\n-- \nAna, typed over");
  });

  it("adds the new signature below typed text that had none, above quoted text", () => {
    expect(swapSignature("Hi there\n", null, "Bo")).toBe("Hi there\n\n-- \nBo\n");
    expect(swapSignature("Thanks!\n\nOn Mon, Ana wrote:\n> hi", null, "Bo")).toBe("Thanks!\n\n-- \nBo\n\nOn Mon, Ana wrote:\n> hi");
    expect(swapSignature("Hi there", null, null)).toBe("Hi there");
  });

  it("recognises a body that is only the signature", () => {
    expect(signatureBlock("Ana")).toBe(withSignature("", "Ana"));
    expect(signatureBlock(null)).toBe("");
  });
});
