import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render } from "@solidjs/testing-library";
import DOMPurify from "dompurify";
import { MessageBody } from "./MessageBody";

describe("MessageBody", () => {
  it("keeps the table layout attributes newsletters rely on", () => {
    const html =
      '<table cellpadding="4" cellspacing="0" border="0" bgcolor="#eeeeee" align="center">' +
      '<tr><td colspan="2" rowspan="1" align="right" valign="top" bgcolor="#ffffff">x</td></tr></table>';
    const { container } = render(() => <MessageBody body={html} msgId="m1" />);
    const table = container.querySelector("table")!;
    expect(table.getAttribute("bgcolor")).toBe("#eeeeee");
    expect(table.getAttribute("align")).toBe("center");
    expect(table.getAttribute("cellpadding")).toBe("4");
    expect(table.getAttribute("cellspacing")).toBe("0");
    expect(table.getAttribute("border")).toBe("0");
    const td = container.querySelector("td")!;
    expect(td.getAttribute("colspan")).toBe("2");
    expect(td.getAttribute("rowspan")).toBe("1");
    expect(td.getAttribute("align")).toBe("right");
    expect(td.getAttribute("valign")).toBe("top");
    expect(td.getAttribute("bgcolor")).toBe("#ffffff");
  });

  it("still strips scripts and event handlers", () => {
    const { container } = render(() => (
      <MessageBody body={'<img src="x" onerror="alert(1)"><script>alert(2)</script><p>ok</p>'} msgId="m1" />
    ));
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")!.hasAttribute("onerror")).toBe(false);
    expect(container.textContent).toContain("ok");
  });

  it("forces rel=noopener on _blank links and drops other targets", () => {
    const { container } = render(() => (
      <MessageBody body={'<a href="https://a" target="_blank">a</a><a href="https://b" target="_top">b</a>'} msgId="m1" />
    ));
    const [a, b] = container.querySelectorAll("a");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(b.hasAttribute("target")).toBe(false);
  });

  it("replaces cid: images with inline data from the message parts", () => {
    const parts = [{
      mimeType: "image/gif",
      headers: [{ name: "Content-ID", value: "<logo@x>" }],
      body: { data: "R0lGOD-_" },
    }];
    const { container } = render(() => (
      <MessageBody body={'<img src="cid:logo@x">'} msgId="m1" msgPayloadParts={parts} />
    ));
    expect(container.querySelector("img")!.getAttribute("src")).toBe("data:image/gif;base64,R0lGOD+/");
  });

  it("does not let an email borrow the app's own classes", () => {
    const { container } = render(() => (
      <MessageBody body={'<div class="card btn">receipt</div>'} msgId="m1" />
    ));
    const div = container.querySelector(".message-body div")!;
    expect(div.textContent).toBe("receipt");
    expect(div.hasAttribute("class")).toBe(false);
  });

  it("uses the part's mime type for a cid image fetched on demand", () => {
    const parts = [{
      mimeType: "image/jpeg",
      headers: [{ name: "Content-ID", value: "<pic@x>" }],
      body: { attachmentId: "att1" },
    }];
    const { container } = render(() => (
      <MessageBody body={'<img src="cid:pic@x">'} msgId="m1" msgPayloadParts={parts} cidAttachmentData={{ "pic@x": "AB-_" }} />
    ));
    expect(container.querySelector("img")!.getAttribute("src")).toBe("data:image/jpeg;base64,AB+/");
  });

  it("falls back to a thread attachment's inline data by Content-ID", () => {
    const threadAttachments = [{
      message_id: "m1", attachment_id: "a1", content_id: "logo@x", inline_data: "QUJD", mime_type: "image/png",
    }];
    const { container } = render(() => (
      <MessageBody body={'<img src="cid:logo@x">'} msgId="m1" threadAttachments={threadAttachments} />
    ));
    expect(container.querySelector("img")!.getAttribute("src")).toBe("data:image/png;base64,QUJD");
  });

  it("takes an inline part's data from this message's listing entry with the same attachment id", () => {
    const parts = [{
      mimeType: "image/gif",
      headers: [{ name: "Content-ID", value: "<logo@x>" }],
      body: { attachmentId: "a1" },
    }];
    const threadAttachments = [
      { message_id: "m0", attachment_id: "a1", content_id: "logo@x", inline_data: "T1RIRVI=", mime_type: "image/png" },
      { message_id: "m1", attachment_id: "a1", content_id: null, inline_data: "R0lG", mime_type: "image/gif" },
    ];
    const { container } = render(() => (
      <MessageBody body={'<img src="cid:logo@x">'} msgId="m1" msgPayloadParts={parts} threadAttachments={threadAttachments} />
    ));
    expect(container.querySelector("img")!.getAttribute("src")).toBe("data:image/gif;base64,R0lG");
  });

  it("ignores another message's attachments with the same Content-ID", () => {
    const threadAttachments = [{
      message_id: "m0", attachment_id: "a1", content_id: "logo@x", inline_data: "QUJD", mime_type: "image/png",
    }];
    const { container } = render(() => (
      <MessageBody body={'<img src="cid:logo@x">'} msgId="m1" threadAttachments={threadAttachments} />
    ));
    expect(container.querySelector("img")!.getAttribute("src")).toBe("cid:logo@x");
  });
});

describe("MessageBody cid image updates", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not re-sanitize a message when cid images for other messages arrive", () => {
    const [cidData, setCidData] = createSignal<Record<string, string>>({});
    const sanitize = vi.spyOn(DOMPurify, "sanitize");
    const { container } = render(() => (
      <>
        <MessageBody body={"<p>plain</p>"} msgId="m1" cidAttachmentData={cidData()} />
        <MessageBody body={'<img src="cid:a@x"><p>see above</p>'} msgId="m2" cidAttachmentData={cidData()} />
      </>
    ));
    expect(sanitize).toHaveBeenCalledTimes(2);

    setCidData({ "b@x": "QUJD" });
    expect(sanitize).toHaveBeenCalledTimes(2);

    setCidData({ "b@x": "QUJD", "a@x": "REVG" });
    expect(sanitize).toHaveBeenCalledTimes(3);
    expect(container.querySelectorAll("img")[0].getAttribute("src")).toBe("data:image/png;base64,REVG");
  });
});

describe("MessageBody quoted history", () => {
  const reply = '<div>Thanks!</div><div class="gmail_quote"><div>On Mon, Ana wrote:</div><blockquote class="gmail_quote">Earlier <img src="cid:logo@x"></blockquote></div>';

  it("folds the history a reply quotes behind a toggle that shows it again", () => {
    const { container, getByRole } = render(() => <MessageBody body={reply} msgId="m1" />);
    expect(container.textContent).toContain("Thanks!");
    expect(container.textContent).not.toContain("Earlier");
    const toggle = getByRole("button", { name: "Show quoted text" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.querySelector("svg[data-icon=more]")).not.toBeNull();

    fireEvent.click(toggle);
    expect(container.textContent).toContain("On Mon, Ana wrote:");
    expect(container.textContent).toContain("Earlier");
    expect(getByRole("button", { name: "Hide quoted text" })).toHaveAttribute("aria-expanded", "true");
  });

  it("still sanitizes and fills in cid images inside the folded history", () => {
    const parts = [{ mimeType: "image/gif", headers: [{ name: "Content-ID", value: "<logo@x>" }], body: { data: "R0lG" } }];
    const { container, getByRole } = render(() => (
      <MessageBody body={reply.replace("Earlier", 'Earlier <img src="x" onerror="alert(1)">')} msgId="m1" msgPayloadParts={parts} />
    ));
    fireEvent.click(getByRole("button", { name: "Show quoted text" }));
    const [bad, logo] = container.querySelectorAll("img");
    expect(bad.hasAttribute("onerror")).toBe(false);
    expect(logo.getAttribute("src")).toBe("data:image/gif;base64,R0lG");
  });

  it("shows no toggle for a message without quoted history", () => {
    const { queryByRole } = render(() => <MessageBody body="<p>Hello</p>" msgId="m1" />);
    expect(queryByRole("button")).toBeNull();
  });
});
