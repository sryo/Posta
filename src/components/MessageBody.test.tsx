import { describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
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
});
