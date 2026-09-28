import { describe, expect, it } from "vitest";
import type { Contact } from "../api/tauri";
import { completeRecipient, currentRecipient, matchContacts, rankContacts } from "./contacts";

const NOW = Date.UTC(2026, 8, 28);
const DAY = 86_400_000;
const google = (name: string | null, ...emails: string[]): Contact => ({
  resource_name: `people/${emails[0]}`, display_name: name, email_addresses: emails, photo_url: null,
});

describe("rankContacts", () => {
  it("ranks frequent recent correspondents above address-book-only contacts", () => {
    const ranked = rankContacts(
      [google("Zed", "zed@x.com"), google("Ana Book", "ana@x.com")],
      [
        { participants: ["ana@x.com", "Me <me@x.com>"], last_message_date: NOW - DAY },
        { participants: ["Ana <ana@x.com>"], last_message_date: NOW - 2 * DAY },
      ],
      "ME@x.com",
      NOW,
    );
    expect(ranked.map(c => [c.email, c.frequency])).toEqual([["ana@x.com", 2], ["zed@x.com", 0]]);
    expect(ranked[0].name).toBe("Ana Book");
    expect(ranked[0].lastContacted).toBe(NOW - DAY);
  });

  it("keeps every contact, not just the top few", () => {
    const contacts = Array.from({ length: 20 }, (_, i) => google(null, `c${i}@x.com`));
    expect(rankContacts(contacts, [], "me@x.com", NOW)).toHaveLength(20);
  });

  it("takes a name from a thread when the address book has none", () => {
    const [c] = rankContacts([google(null, "bo@x.com")], [{ participants: ["Bo Diaz <BO@x.com>"], last_message_date: NOW }], undefined, NOW);
    expect(c).toMatchObject({ email: "bo@x.com", name: "Bo Diaz", frequency: 1 });
  });
});

describe("matchContacts", () => {
  const contacts = rankContacts([google("Zed Alpha", "zed@x.com"), google(null, "bo@y.com")], [], undefined, NOW);

  it("matches on address or name, case-insensitively", () => {
    expect(matchContacts(contacts, "ALPHA", 5).map(c => c.email)).toEqual(["zed@x.com"]);
    expect(matchContacts(contacts, "y.com", 5).map(c => c.email)).toEqual(["bo@y.com"]);
  });

  it("returns the top contacts for an empty query", () => {
    expect(matchContacts(contacts, " ", 1)).toHaveLength(1);
  });
});

describe("recipient completion", () => {
  it("reads the recipient being typed after earlier ones", () => {
    expect(currentRecipient("ana@x.com, bo")).toBe("bo");
    expect(currentRecipient("bo")).toBe("bo");
    expect(currentRecipient('"Doe, Jo" <jo@x.com>, ze')).toBe("ze");
    expect(currentRecipient('"Doe, J')).toBe('"Doe, J');
  });

  it("replaces only the recipient being typed", () => {
    expect(completeRecipient("ana@x.com, bo", "bo@y.com")).toBe("ana@x.com, bo@y.com");
    expect(completeRecipient("ana@x.com,bo", "bo@y.com")).toBe("ana@x.com, bo@y.com");
    expect(completeRecipient("bo", "bo@y.com")).toBe("bo@y.com");
    expect(completeRecipient("", "bo@y.com")).toBe("bo@y.com");
  });
});
