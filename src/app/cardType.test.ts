import { describe, expect, it } from "vitest";
import { cardTypeForQuery } from "./cardType";

describe("cardTypeForQuery", () => {
  it("makes a card with a calendar: query a calendar card", () => {
    expect(cardTypeForQuery("calendar:7d")).toBe("calendar");
    expect(cardTypeForQuery("Calendar:Today")).toBe("calendar");
  });

  it("makes any other query an email card", () => {
    expect(cardTypeForQuery("is:inbox")).toBe("email");
    expect(cardTypeForQuery("")).toBe("email");
  });
});
