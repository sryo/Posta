import { describe, expect, it } from "vitest";
import { replyPlaceholder, sendingTo } from "./replyWords";

const OWN = ["me@x.com"];

describe("replyPlaceholder", () => {
  it("names the one person a reply goes to by first name", () => {
    expect(replyPlaceholder(["Ana Pérez <ana@x.com>"], OWN)).toBe("Reply to Ana…");
  });

  it("names two, then two and how many more", () => {
    expect(replyPlaceholder(["Ana Pérez <ana@x.com>", "Ben Ruiz <ben@x.com>"], OWN)).toBe("Reply to Ana and Ben…");
    expect(replyPlaceholder(["Ana <ana@x.com>", "Ben <ben@x.com>", "Cleo <cleo@x.com>"], OWN)).toBe("Reply to Ana, Ben and Cleo…");
    expect(replyPlaceholder(["Ana <ana@x.com>", "Ben <ben@x.com>", "c@x.com", "d@x.com", "e@x.com"], OWN))
      .toBe("Reply to Ana, Ben and 3 others…");
  });

  it("prefers the contact's own name, and shows an unnamed address whole", () => {
    const nameFor = (email: string) => (email === "ana@x.com" ? "Anita Gómez" : undefined);
    expect(replyPlaceholder(["Ana Pérez <ana@x.com>", "bo@y.com"], OWN, nameFor)).toBe("Reply to Anita and bo@y.com…");
  });

  it("leaves out the user and anyone named twice", () => {
    expect(replyPlaceholder(["me@x.com", "Ana <ana@x.com>", "ANA@x.com"], OWN)).toBe("Reply to Ana…");
  });

  it("has nothing to say without a recipient", () => {
    expect(replyPlaceholder([], OWN)).toBeNull();
    expect(replyPlaceholder(["me@x.com", " "], OWN)).toBeNull();
  });
});

describe("sendingTo", () => {
  // Thursday 1 Oct 2026, and the Sunday after
  const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes);

  it("says who it goes to during a weekday", () => {
    expect(sendingTo(["Ana Pérez <ana@x.com>"], OWN, at(1, 14), undefined, "en-US")).toBe("to Ana");
    expect(sendingTo(["Ana <ana@x.com>", "ben@x.com"], OWN, at(1, 6), undefined, "en-US")).toBe("to Ana and ben@x.com");
  });

  it("adds the time from 10 PM to 6 AM", () => {
    expect(sendingTo(["Ana <ana@x.com>"], OWN, at(1, 23, 48), undefined, "en-US")).toMatch(/^to Ana at 11:48\sPM$/);
    expect(sendingTo(["Ana <ana@x.com>"], OWN, at(2, 5, 59), undefined, "en-US")).toMatch(/^to Ana at 5:59\sAM$/);
    expect(sendingTo(["Ana <ana@x.com>"], OWN, at(1, 22), undefined, "en-US")).toMatch(/at 10:00\sPM$/);
  });

  it("adds the day at the weekend, and the time too late at night", () => {
    expect(sendingTo(["Ana <ana@x.com>"], OWN, at(4, 11), undefined, "en-US")).toBe("to Ana on Sunday");
    expect(sendingTo(["Ana <ana@x.com>"], OWN, at(3, 23, 5), undefined, "en-US")).toMatch(/^to Ana on Saturday at 11:05\sPM$/);
  });

  it("is empty with no one to send to", () => {
    expect(sendingTo([], OWN, at(1, 14))).toBe("");
  });
});
