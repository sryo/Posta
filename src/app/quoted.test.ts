import { describe, expect, it } from "vitest";
import { eventName, quoted } from "./quoted";

describe("quoted", () => {
  it("puts a subject or title in curly quotes", () => {
    expect(quoted("Venue for the offsite")).toBe("“Venue for the offsite”");
  });

  it("cuts a long one at about 32 characters with an ellipsis", () => {
    expect(quoted("Contract v3, two redlines and a question about the venue")).toBe("“Contract v3, two redlines and a…”");
    expect(quoted("x".repeat(32))).toBe(`“${"x".repeat(32)}”`);
  });

  it("gives nothing for an empty or blank one, so the caller can say something else", () => {
    expect(quoted("")).toBeNull();
    expect(quoted("   ")).toBeNull();
  });
});

describe("eventName", () => {
  it("names an event by its title, and an untitled one as the event", () => {
    expect(eventName({ title: "Planning" })).toBe("“Planning”");
    expect(eventName({ title: "" })).toBe("the event");
  });
});
