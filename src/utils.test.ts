import { afterEach, describe, expect, it } from "vitest";
import {
  addForwardPrefix,
  distinctAvatarColors,
  getAvatarColor,
  addReplyPrefix,
  buildForwardBody,
  extractEmail,
  extractMessageHtml,
  extractMessageText,
  extractName,
  formatCalendarEventDate,
  formatEmailDate,
  formatTime,
  smoothScroll,
  splitEmailList,
  stripHtml,
  textOrHtmlToHtml,
  truncateMiddle,
  validateEmailList,
} from "./utils";
import { formatClock, formatWhen, relativeDayName } from "./app/dateFormat";

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

  it("takes the address from the final angle brackets when the name has its own", () => {
    const from = '"Jira <jira@tracker.test>" <noreply@tracker.test>';
    expect(extractEmail(from)).toBe("noreply@tracker.test");
    expect(extractName(from)).toBe("Jira <jira@tracker.test>");
    expect(validateEmailList(from)).toEqual({ valid: true, invalidEmails: [] });
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

describe("stripHtml tables", () => {
  it("separates table cells and puts each row on its own line", () => {
    expect(stripHtml("<table><tr><td>Name</td><td>Qty</td></tr><tr><td>Apples</td><td>3</td></tr></table>"))
      .toBe("Name\tQty\nApples\t3");
    expect(stripHtml("<table><tr><th>A</th><th>B</th></tr></table>")).toBe("A\tB");
    expect(stripHtml("<table>\n  <tr>\n    <td> Total </td>\n    <td>\n      <b>9</b> items</td>\n  </tr>\n</table>"))
      .toBe("Total\t9 items");
  });

  it("starts no line with a tab when the previous cell ended in a block", () => {
    expect(stripHtml("<table><tr><td><p>Hello</p></td><td><p>World</p></td></tr></table>")).toBe("Hello\nWorld");
  });
});

describe("formatCalendarEventDate durations", () => {
  const start = new Date(2030, 5, 10, 14, 0).getTime();
  const hours = (h: number) => start + h * 3600_000;

  it("keeps hours and minutes for events under a day", () => {
    expect(formatCalendarEventDate(start, start + 45 * 60_000, false)).toMatch(/2:00\sPM \(45m\)$/);
    expect(formatCalendarEventDate(start, hours(1.5), false)).toMatch(/2:00\sPM \(1h30m\)$/);
    expect(formatCalendarEventDate(start, hours(23), false)).toMatch(/2:00\sPM \(23h\)$/);
  });

  it("shows days for events of a day or longer", () => {
    expect(formatCalendarEventDate(start, hours(24), false)).toMatch(/2:00\sPM \(1d\)$/);
    expect(formatCalendarEventDate(start, hours(72), false)).toMatch(/2:00\sPM \(3d\)$/);
    expect(formatCalendarEventDate(start, hours(26), false)).toMatch(/2:00\sPM \(1d2h\)$/);
  });
});

describe("dates and times in the system locale", () => {
  it("writes an event's time as the locale does, not as a hard-coded 12-hour clock", () => {
    const start = new Date(2030, 5, 10, 0, 41).getTime();
    expect(formatCalendarEventDate(start, start + 3600_000, false)).toBe(`Mon, Jun 10, 2030 ${formatClock(new Date(start))} (1h)`);
  });

  it("names today's and tomorrow's events with the locale's relative day names", () => {
    const today = new Date();
    today.setHours(9, 0, 0, 0);
    expect(formatCalendarEventDate(today.getTime(), null, false)).toBe(`${relativeDayName(today, new Date())} ${formatClock(today)}`);
  });

  it("dates an email relative to today, with the time as the locale writes it", () => {
    const sent = new Date();
    sent.setHours(0, 42, 0, 0);
    expect(formatEmailDate(sent.toString())).toBe(formatWhen(sent, new Date()));
  });

  it("shows a thread's time today as the locale writes it", () => {
    const sent = new Date();
    sent.setHours(0, 30, 0, 0);
    expect(formatTime(sent.getTime())).toBe(formatClock(sent));
  });
});

describe("textOrHtmlToHtml", () => {
  const renderHtml = (html: string) => {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el;
  };

  it("keeps the line breaks of plain text that only carries inline links", () => {
    const el = renderHtml(textOrHtmlToHtml('Join: <a href="https://meet.test/x">call</a>\nAgenda\n- intro'));
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://meet.test/x");
    expect(el.querySelector("[style*='pre-wrap']")).not.toBeNull();
    expect(el.textContent).toBe("Join: call\nAgenda\n- intro");
  });

  it("leaves markup that lays out its own lines as is", () => {
    const html = "<p>One</p>\n<p>Two<br>Three</p>";
    expect(textOrHtmlToHtml(html)).toBe(html);
  });

  it("escapes plain text", () => {
    const el = renderHtml(textOrHtmlToHtml("a <5 min> b\nc"));
    expect(el.textContent).toBe("a <5 min> b\nc");
  });
});

describe("buildForwardBody", () => {
  it("heads the forwarded text with its From, Date, Subject, To and Cc", () => {
    expect(buildForwardBody({
      from: "Alice <alice@example.com>",
      date: "Mon, 1 Jan 2024 10:00:00 +0000",
      subject: "Lunch",
      to: "Bob <bob@example.com>",
      cc: "carol@example.com",
      body: "See you at noon",
    })).toBe(
      "\n\n---------- Forwarded message ----------\n" +
      "From: Alice <alice@example.com>\n" +
      "Date: Mon, 1 Jan 2024 10:00:00 +0000\n" +
      "Subject: Lunch\n" +
      "To: Bob <bob@example.com>\n" +
      "Cc: carol@example.com\n\n" +
      "See you at noon",
    );
  });

  it("leaves out To and Cc lines it has no value for", () => {
    const body = buildForwardBody({ from: "a@x.com", date: "", subject: "Hi", body: "text" });
    expect(body).toBe("\n\n---------- Forwarded message ----------\nFrom: a@x.com\nDate: \nSubject: Hi\n\ntext");
    expect(buildForwardBody({ from: "a@x.com", date: "", subject: "Hi", to: "", cc: "  ", body: "text" })).toBe(body);
  });
});

describe("smoothScroll", () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; });
  const stubMotion = (reduce: boolean) => {
    window.matchMedia = ((query: string) => ({ matches: reduce && query === "(prefers-reduced-motion: reduce)" })) as unknown as typeof window.matchMedia;
  };

  it("animates scrolling by default", () => {
    stubMotion(false);
    expect(smoothScroll()).toBe("smooth");
  });

  it("jumps instead when the system asks for reduced motion", () => {
    stubMotion(true);
    expect(smoothScroll()).toBe("auto");
  });
});

describe("distinctAvatarColors", () => {
  it("keeps each key's own colour while it is free", () => {
    expect(distinctAvatarColors(["ana@x.com"])).toEqual([getAvatarColor("ana@x.com")]);
  });

  it("moves a key whose colour is taken to the next free one", () => {
    const [a, b] = distinctAvatarColors(["mateo@posta.test", "mateo.work@acme.test"]);
    expect(a).toBe(getAvatarColor("mateo@posta.test"));
    expect(b).not.toBe(a);
  });
});
