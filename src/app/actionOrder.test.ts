import { describe, expect, it } from "vitest";
import { normalizeActionOrder } from "./actionOrder";

const DEFAULTS = ["markRead", "star", "archive", "spam"];

describe("normalizeActionOrder", () => {
  it("keeps the user's order and appends actions added since", () => {
    expect(normalizeActionOrder(["archive", "markRead", "star"], DEFAULTS)).toEqual(["archive", "markRead", "star", "spam"]);
  });

  it("drops unknown and repeated entries", () => {
    expect(normalizeActionOrder(["star", "gone", "star", 3], DEFAULTS)).toEqual(["star", "markRead", "archive", "spam"]);
  });

  it("falls back to the defaults for a corrupt value", () => {
    expect(normalizeActionOrder({ not: "a list" }, DEFAULTS)).toEqual(DEFAULTS);
    expect(normalizeActionOrder(null, DEFAULTS)).toEqual(DEFAULTS);
  });
});
