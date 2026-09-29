import { describe, expect, it, vi } from "vitest";
import { isMailingList, runUnsubscribe, unsubscribeMethod } from "./unsubscribe";

const headers = (h: Record<string, string>) => Object.entries(h).map(([name, value]) => ({ name, value }));

describe("unsubscribeMethod", () => {
  it("prefers the one-click POST when the sender offers it", () => {
    expect(unsubscribeMethod(headers({
      "List-Unsubscribe": "<mailto:leave@list.test?subject=stop>, <https://list.test/u/123>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }))).toEqual({ kind: "oneClick", url: "https://list.test/u/123" });
  });

  it("sends the mailto: request when there is no one-click link", () => {
    expect(unsubscribeMethod(headers({ "list-unsubscribe": "<https://list.test/u/1>,<mailto:leave@list.test?subject=stop>" })))
      .toEqual({ kind: "mailto", to: "leave@list.test", subject: "stop", body: "" });
  });

  it("opens the web page as a last resort, and only https ones", () => {
    expect(unsubscribeMethod(headers({ "List-Unsubscribe": "<https://list.test/u/1>" })))
      .toEqual({ kind: "web", url: "https://list.test/u/1" });
    expect(unsubscribeMethod(headers({ "List-Unsubscribe": "<http://list.test/u/1>" }))).toBeNull();
    expect(unsubscribeMethod(headers({ "List-Unsubscribe": "<javascript:alert(1)>" }))).toBeNull();
  });

  it("finds nothing on mail that is not from a list", () => {
    expect(unsubscribeMethod(headers({ From: "ana@x.test" }))).toBeNull();
    expect(unsubscribeMethod(undefined)).toBeNull();
  });
});

describe("isMailingList", () => {
  it("recognises list headers and bulk precedence", () => {
    expect(isMailingList(headers({ "List-Id": "<news.list.test>" }))).toBe(true);
    expect(isMailingList(headers({ "List-Unsubscribe": "<https://x.test>" }))).toBe(true);
    expect(isMailingList(headers({ Precedence: " List " }))).toBe(true);
    expect(isMailingList(headers({ Precedence: "bulk" }))).toBe(true);
    expect(isMailingList(headers({ From: "ana@x.test" }))).toBe(false);
  });
});

describe("runUnsubscribe", () => {
  const api = () => ({ sendEmail: vi.fn(async () => {}), postOneClick: vi.fn(async () => {}), openUrl: vi.fn(async () => {}) });

  it("posts the one-click request", async () => {
    const deps = api();
    expect(await runUnsubscribe("acc", { kind: "oneClick", url: "https://list.test/u" }, deps)).toBe("done");
    expect(deps.postOneClick).toHaveBeenCalledWith("https://list.test/u");
  });

  it("emails the list's address, with a subject even when the link gives none", async () => {
    const deps = api();
    expect(await runUnsubscribe("acc", { kind: "mailto", to: "leave@list.test", subject: "", body: "" }, deps)).toBe("done");
    expect(deps.sendEmail).toHaveBeenCalledWith("acc", "leave@list.test", "", "", "Unsubscribe", "");
  });

  it("opens the page for a link that needs the reader to confirm there", async () => {
    const deps = api();
    expect(await runUnsubscribe("acc", { kind: "web", url: "https://list.test/u" }, deps)).toBe("opened");
    expect(deps.openUrl).toHaveBeenCalledWith("https://list.test/u");
  });
});
