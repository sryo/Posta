import { describe, expect, it } from "vitest";
import { splitQuotedHtml, splitQuotedText } from "./quotedHistory";

const text = (html: string) => new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";

describe("splitQuotedText", () => {
  it("separates the attribution and quoted lines at the end of a reply", () => {
    const body = "Sounds good.\n\n--\nMateo\n\nOn Mon, 1 Jan 2024, Ana <ana@x> wrote:\n> Hi\n>\n> Lunch?";
    expect(splitQuotedText(body)).toEqual({
      head: "Sounds good.\n\n--\nMateo",
      quoted: "\n\nOn Mon, 1 Jan 2024, Ana <ana@x> wrote:\n> Hi\n>\n> Lunch?",
    });
  });

  it("recognises an attribution line that wrapped", () => {
    const body = "Yes\n\nOn Mon, Sep 22, 2026 at 10:14 AM Mateo Yadarola\n<mateo@x> wrote:\n\n> Hi";
    expect(splitQuotedText(body)?.head).toBe("Yes");
  });

  it("folds a trailing run of quoted lines with no attribution", () => {
    expect(splitQuotedText("Agreed\n> earlier\n> text\n")).toEqual({ head: "Agreed", quoted: "\n> earlier\n> text\n" });
  });

  it("leaves quotes that are answered inline, and bodies with no quote", () => {
    expect(splitQuotedText("> question one\nanswer one\n> question two\nanswer two")).toBeNull();
    expect(splitQuotedText("Just a note")).toBeNull();
  });

  it("finds the quote in a reply nothing has been written above yet", () => {
    expect(splitQuotedText("\n\nOn Mon, Ana wrote:\n> Hi")).toEqual({ head: "", quoted: "\n\nOn Mon, Ana wrote:\n> Hi" });
  });
});

describe("splitQuotedHtml", () => {
  it("folds Gmail's quote, attribution included", () => {
    const html = '<div dir="ltr">Thanks!</div><br><div class="gmail_quote"><div class="gmail_attr">On Mon, Ana wrote:<br></div><blockquote class="gmail_quote">Hi</blockquote></div>';
    const split = splitQuotedHtml(html)!;
    expect(text(split.main).trim()).toBe("Thanks!");
    expect(text(split.quoted)).toContain("On Mon, Ana wrote:");
    expect(text(split.quoted)).toContain("Hi");
  });

  it("folds an Apple Mail cite quote together with the attribution before it", () => {
    const html = "<div>Sure</div><div><br><blockquote type=\"cite\">old</blockquote></div>";
    const withAttribution = "<div>Sure</div><div>On 1 Jan, Ana wrote:</div><blockquote type=\"cite\">old</blockquote>";
    expect(text(splitQuotedHtml(html)!.main).trim()).toBe("Sure");
    const split = splitQuotedHtml(withAttribution)!;
    expect(text(split.main).trim()).toBe("Sure");
    expect(text(split.quoted)).toContain("Ana wrote:");
  });

  it("folds Outlook's reply header and everything after it", () => {
    const html = '<p>See below</p><hr><div id="divRplyFwdMsg"><b>From:</b> Ana</div><div>old text</div>';
    const split = splitQuotedHtml(html)!;
    expect(text(split.main)).toContain("See below");
    expect(text(split.main)).not.toContain("old text");
    expect(text(split.quoted)).toContain("old text");
  });

  it("folds quoted lines inside a plain-text body", () => {
    const html = '<div style="white-space: pre-wrap">Yes\n\nOn Mon, Ana &lt;a@x&gt; wrote:\n&gt; Lunch?</div>';
    const split = splitQuotedHtml(html)!;
    expect(text(split.main).trim()).toBe("Yes");
    expect(text(split.quoted)).toContain("> Lunch?");
    expect(split.main).toContain("white-space: pre-wrap");
    expect(split.quoted).toContain("white-space: pre-wrap");
  });

  it("keeps a body with no quote, or a quote with nothing written above it, whole", () => {
    expect(splitQuotedHtml("<p>Hello</p><blockquote>A quote a newsletter uses</blockquote><p>More</p>")).toBeNull();
    expect(splitQuotedHtml('<div class="gmail_quote">only the forward</div>')).toBeNull();
    expect(splitQuotedHtml('<div style="white-space: pre-wrap">On Mon, Ana wrote:\n&gt; Hi</div>')).toBeNull();
  });
});
