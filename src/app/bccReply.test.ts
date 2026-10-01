import { describe, expect, it } from "vitest";
import { bccNotice, wasBcc } from "./bccReply";

const ME = ["me@x.com"];
const message = (headers: Record<string, string>) => ({
  payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
});
const bcced = (extra: Record<string, string> = {}) => message({
  From: "Jules Bernard <jules@lumen.studio>",
  To: "Marta Ruiz <marta@lumen.studio>, design-team@lumen.studio",
  Cc: "ben@lumen.studio, cleo@lumen.studio",
  "Delivered-To": "me@x.com",
  ...extra,
});

describe("wasBcc", () => {
  it("is true when the user is in neither To nor Cc of a message delivered to them", () => {
    expect(wasBcc(bcced(), ME, [])).toBe(true);
  });

  it("is false when the user is in To or Cc", () => {
    expect(wasBcc(bcced({ Cc: "Me <ME@x.com>" }), ME, [])).toBe(false);
    expect(wasBcc(bcced({ To: "me@x.com" }), ME, [])).toBe(false);
  });

  it("is false for a mailing list, which leaves the user out of To too", () => {
    expect(wasBcc(bcced({ "List-Id": "<design.lumen.studio>" }), ME, [])).toBe(false);
  });

  it("is false when To or Cc has an address the user sends from", () => {
    expect(wasBcc(bcced({ Cc: "me@alias.com" }), ME, ["me@alias.com"])).toBe(false);
  });

  it("is false for the user's own message", () => {
    expect(wasBcc(bcced({ From: "me@x.com" }), ME, [])).toBe(false);
  });

  it("is false unless it was delivered to the user's account", () => {
    expect(wasBcc(bcced({ "Delivered-To": "other@x.com" }), ME, [])).toBe(false);
    const noDelivery = bcced();
    noDelivery.payload.headers = noDelivery.payload.headers.filter(h => h.name !== "Delivered-To");
    expect(wasBcc(noDelivery, ME, [])).toBe(false);
  });
});

describe("bccNotice", () => {
  it("says who Reply all would show, and offers the sender alone", () => {
    const notice = bccNotice(bcced(), { to: "jules@lumen.studio", cc: "marta@lumen.studio, design-team@lumen.studio, ben@lumen.studio, cleo@lumen.studio" }, ME, []);
    expect(notice).toEqual({
      line: "You were Bcc'd. Reply all shows Marta Ruiz and 3 others that you have this.",
      sender: "jules@lumen.studio",
      only: "Reply to Jules only",
    });
  });

  it("names one or two people in full", () => {
    expect(bccNotice(bcced(), { to: "jules@lumen.studio", cc: "marta@lumen.studio" }, ME, [])?.line)
      .toBe("You were Bcc'd. Reply all shows Marta Ruiz that you have this.");
    expect(bccNotice(bcced(), { to: "jules@lumen.studio", cc: "marta@lumen.studio, ben@lumen.studio" }, ME, [])?.line)
      .toBe("You were Bcc'd. Reply all shows Marta Ruiz and ben@lumen.studio that you have this.");
  });

  it("has nothing to say when Reply all reaches only the sender, or the user wasn't Bcc'd", () => {
    expect(bccNotice(bcced(), { to: "jules@lumen.studio", cc: "" }, ME, [])).toBeNull();
    expect(bccNotice(bcced({ To: "me@x.com" }), { to: "jules@lumen.studio", cc: "marta@lumen.studio" }, ME, [])).toBeNull();
  });
});
