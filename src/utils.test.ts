import { describe, expect, it } from "vitest";
import {
  addForwardPrefix,
  addReplyPrefix,
  extractEmail,
  extractMessageHtml,
  extractMessageText,
  extractName,
  splitEmailList,
  stripHtml,
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

const b64url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("stripHtml", () => {
  it("keeps paragraph and line breaks", () => {
    expect(stripHtml("<p>Hi Ann,</p><p>See you<br>tomorrow</p>")).toBe("Hi Ann,\nSee you\ntomorrow");
    expect(stripHtml("<div>one</div><div>two</div>")).toBe("one\ntwo");
  });

  it("drops style and script contents", () => {
    expect(stripHtml("<style>.x{color:red}</style><p>Hello</p><script>evil()</script>")).toBe("Hello");
  });

  it("decodes entities", () => {
    expect(stripHtml("Tom &amp; Jerry &lt;3")).toBe("Tom & Jerry <3");
  });
});

describe("message body extraction", () => {
  const plainPayload = (text: string) => ({ mimeType: "text/plain", body: { data: b64url(text) } });

  it("renders a plain-text body as escaped, line-preserving HTML", () => {
    const html = extractMessageHtml(plainPayload("Hi,\nwrite to Bob <bob@example.com> & co"));
    const div = document.createElement("div");
    div.innerHTML = html;
    expect(div.textContent).toBe("Hi,\nwrite to Bob <bob@example.com> & co");
    expect(div.querySelector("[style*='pre-wrap']")).not.toBeNull();
  });

  it("prefers the HTML alternative for display", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("plain") } },
        { mimeType: "text/html", body: { data: b64url("<b>rich</b>") } },
      ],
    };
    expect(extractMessageHtml(payload)).toBe("<b>rich</b>");
  });

  it("quotes plain text verbatim, including angle-bracketed addresses", () => {
    expect(extractMessageText(plainPayload("Ask Bob <bob@example.com>\n\nThanks"))).toBe(
      "Ask Bob <bob@example.com>\n\nThanks",
    );
  });

  it("prefers the plain-text alternative for quoting", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("plain version") } },
        { mimeType: "text/html", body: { data: b64url("<p>html version</p>") } },
      ],
    };
    expect(extractMessageText(payload)).toBe("plain version");
  });

  it("strips an HTML-only body for quoting", () => {
    expect(extractMessageText({ mimeType: "text/html", body: { data: b64url("<p>a</p><p>b</p>") } })).toBe("a\nb");
  });

  it("falls back to the snippet", () => {
    expect(extractMessageText({ mimeType: "multipart/mixed", parts: [] }, "It&#39;s here")).toBe("It's here");
    expect(extractMessageHtml(undefined, "It&#39;s here")).toBe("It&#39;s here");
  });
});

describe("extractMessageHtml in the batch reply panel", () => {
  const b64 = (s: string) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_");

  // Render the way the batch reply panel does, then read back what a user sees
  function visibleText(html: string): string {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent ?? "";
  }

  it("escapes a single-part body that is neither plain text nor HTML", () => {
    const html = extractMessageHtml({ mimeType: "text/calendar", body: { data: b64("<b>BEGIN</b>") } });
    expect(visibleText(html)).toBe("<b>BEGIN</b>");
  });

  it("passes an HTML single-part body through", () => {
    const html = extractMessageHtml({ mimeType: "text/html", body: { data: b64("<p>Hi <b>there</b></p>") } });
    expect(html).toContain("<b>there</b>");
  });

  it("keeps angle brackets in a single-part plain-text body visible", () => {
    const text = "Write to Ana <ana@example.com>\nif x < y && y > z";
    const html = extractMessageHtml({ mimeType: "text/plain", body: { data: b64(text) } });
    expect(visibleText(html)).toBe(text);
  });

  it("keeps angle brackets in a plain-text part of a multipart message visible", () => {
    const text = "See <https://example.com> & reply";
    const html = extractMessageHtml({
      mimeType: "multipart/alternative",
      parts: [{ mimeType: "text/plain", body: { data: b64(text) } }],
    });
    expect(visibleText(html)).toBe(text);
  });

  it("prefers the HTML part over the plain-text part", () => {
    const html = extractMessageHtml({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("plain") } },
        { mimeType: "text/html", body: { data: b64("<i>rich</i>") } },
      ],
    });
    expect(html).toBe("<i>rich</i>");
  });

  it("falls back to the snippet, then a placeholder", () => {
    expect(extractMessageHtml({ mimeType: "multipart/mixed", parts: [] }, "snip")).toBe("snip");
    expect(extractMessageHtml(undefined)).toBe("(No content)");
  });
});
