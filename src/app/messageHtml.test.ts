import { describe, expect, it } from "vitest";
import { messageBodyHtml } from "./messageHtml";

const b64 = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_");

// Render the way the batch reply panel does, then read back what a user sees
function visibleText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? "";
}

describe("messageBodyHtml", () => {
  it("passes an HTML single-part body through", () => {
    const html = messageBodyHtml({ mimeType: "text/html", body: { data: b64("<p>Hi <b>there</b></p>") } });
    expect(html).toContain("<b>there</b>");
  });

  it("keeps angle brackets in a single-part plain-text body visible", () => {
    const text = "Write to Ana <ana@example.com>\nif x < y && y > z";
    const html = messageBodyHtml({ mimeType: "text/plain", body: { data: b64(text) } });
    expect(visibleText(html)).toBe(text);
  });

  it("keeps angle brackets in a plain-text part of a multipart message visible", () => {
    const text = "See <https://example.com> & reply";
    const html = messageBodyHtml({
      mimeType: "multipart/alternative",
      parts: [{ mimeType: "text/plain", body: { data: b64(text) } }],
    });
    expect(visibleText(html)).toBe(text);
    expect(html).toMatch(/^<pre/);
  });

  it("prefers the HTML part over the plain-text part", () => {
    const html = messageBodyHtml({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("plain") } },
        { mimeType: "text/html", body: { data: b64("<i>rich</i>") } },
      ],
    });
    expect(html).toBe("<i>rich</i>");
  });

  it("falls back to the snippet, then a placeholder", () => {
    expect(messageBodyHtml({ mimeType: "multipart/mixed", parts: [] }, "snip")).toBe("snip");
    expect(messageBodyHtml(undefined)).toBe("(No content)");
  });
});
