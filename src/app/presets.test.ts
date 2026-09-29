import { describe, expect, it } from "vitest";
import { PRESETS } from "./presets";

describe("Posta preset", () => {
  const cards = PRESETS.posta.cards;

  it("keeps important inbox mail in Hot however old it is", () => {
    expect(cards.find(c => c.name === "Hot")?.query).toBe("is:important in:inbox");
  });

  it("has a collapsed catch-all card so no inbox mail goes unseen", () => {
    const rest = cards.find(c => c.name === "Everything else");
    expect(rest).toMatchObject({ query: "in:inbox", collapsed: true });
  });
});
