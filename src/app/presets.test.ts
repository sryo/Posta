import { describe, expect, it } from "vitest";
import { PRESETS } from "./presets";

describe("Posta preset", () => {
  const cards = PRESETS.posta.cards;

  it("keeps important inbox mail in Hot until it's read", () => {
    expect(cards.find(c => c.name === "Hot")?.query).toBe("is:important is:unread in:inbox");
  });

  it("brings back mail read two to four days ago that you never answered in Ping", () => {
    expect(cards.find(c => c.name === "Ping")?.query).toBe("is:read older_than:2d newer_than:4d -in:sent -is:muted");
  });

  it("shows what you sent three to seven days ago in Waiting, leaving out invites", () => {
    expect(cards.find(c => c.name === "Waiting")?.query).toBe("in:sent older_than:3d newer_than:7d -filename:ics -is:muted");
  });

  it("stashes mail with files in Stash, leaving out invites, whose .ics Gmail counts as an attachment", () => {
    expect(cards.find(c => c.name === "Stash")?.query).toBe("has:attachment -filename:ics");
  });

  it("has a collapsed catch-all card so no inbox mail goes unseen", () => {
    const rest = cards.find(c => c.name === "Everything else");
    expect(rest).toMatchObject({ query: "in:inbox", collapsed: true });
  });
});
