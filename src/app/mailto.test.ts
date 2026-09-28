import { describe, expect, it } from "vitest";
import { parseMailto } from "./mailto";

describe("parseMailto", () => {
  it("reads the address and the header fields", () => {
    expect(parseMailto("mailto:ana@x.com?subject=Hello%20there&cc=bo@y.com&body=Line%201%0ALine%202")).toEqual({
      to: "ana@x.com", cc: "bo@y.com", bcc: "", subject: "Hello there", body: "Line 1\nLine 2",
    });
  });

  it("adds recipients from to= to the address", () => {
    expect(parseMailto("mailto:ana@x.com?to=bo@y.com&TO=cy@z.com").to).toBe("ana@x.com, bo@y.com, cy@z.com");
  });

  it("keeps a plus sign and tolerates a broken escape", () => {
    expect(parseMailto("MAILTO:ana+tag@x.com?subject=100%").to).toBe("ana+tag@x.com");
    expect(parseMailto("mailto:ana@x.com?subject=100%").subject).toBe("100%");
  });

  it("allows no address", () => {
    expect(parseMailto("mailto:?subject=Hi")).toMatchObject({ to: "", subject: "Hi" });
  });
});
