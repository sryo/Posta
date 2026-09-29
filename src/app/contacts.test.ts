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
      ["ME@x.com"],
      NOW,
    );
    expect(ranked.map(c => [c.email, c.frequency])).toEqual([["ana@x.com", 2], ["zed@x.com", 0]]);
    expect(ranked[0].name).toBe("Ana Book");
    expect(ranked[0].lastContacted).toBe(NOW - DAY);
  });

  it("leaves out every signed-in account's own address", () => {
    const ranked = rankContacts(
      [google("Work me", "b@x.com")],
      [{ participants: ["A <a@x.com>", "B <B@x.com>", "Bo <bo@x.com>"], last_message_date: NOW }],
      ["a@x.com", "b@x.com"],
      NOW,
    );
    expect(ranked.map(c => c.email)).toEqual(["bo@x.com"]);
  });

  it("keeps every contact, not just the top few", () => {
    const contacts = Array.from({ length: 20 }, (_, i) => google(null, `c${i}@x.com`));
    expect(rankContacts(contacts, [], ["me@x.com"], NOW)).toHaveLength(20);
  });

  it("takes a name from a thread when the address book has none", () => {
    const [c] = rankContacts([google(null, "bo@x.com")], [{ participants: ["Bo Diaz <BO@x.com>"], last_message_date: NOW }], [], NOW);
    expect(c).toMatchObject({ email: "bo@x.com", name: "Bo Diaz", frequency: 1 });
  });
});

describe("matchContacts", () => {
  const contacts = rankContacts([google("Zed Alpha", "zed@x.com"), google(null, "bo@y.com")], [], [], NOW);

  it("matches on address or name, case-insensitively", () => {
    expect(matchContacts(contacts, "ALPHA", 5).map(c => c.email)).toEqual(["zed@x.com"]);
    expect(matchContacts(contacts, "y.com", 5).map(c => c.email)).toEqual(["bo@y.com"]);
  });

  it("returns the top contacts for an empty query", () => {
    expect(matchContacts(contacts, " ", 1)).toHaveLength(1);
  });

  it("ranks names and addresses that start with the query above ones that only contain it", () => {
    const ranked = rankContacts([], [
      { participants: ["Maria Soto <msoto@x.com>"], last_message_date: NOW },
      { participants: ["Tomas <tomas@x.com>"], last_message_date: NOW - DAY },
      { participants: ["Ana Tomasini <ana@x.com>"], last_message_date: NOW - 2 * DAY },
    ], [], NOW);
    expect(matchContacts(ranked, "to", 5).map(c => c.email)).toEqual(["tomas@x.com", "ana@x.com", "msoto@x.com"]);
  });

  it("counts a query that runs past the first name as starting the name", () => {
    const ranked = rankContacts([], [
      { participants: ["Juana Soto <jsoto@x.com>"], last_message_date: NOW },
      { participants: ["Ana Sosa <asosa@x.com>"], last_message_date: NOW - DAY },
    ], [], NOW);
    expect(matchContacts(ranked, "ana so", 5).map(c => c.email)).toEqual(["asosa@x.com", "jsoto@x.com"]);
  });

  it("puts no-reply addresses below people", () => {
    const ranked = rankContacts([], [
      { participants: ["Acme <no-reply@acme.com>"], last_message_date: NOW },
      { participants: ["noreply@alerts.acme.com"], last_message_date: NOW },
      { participants: ["Ada <ada@acme.com>"], last_message_date: NOW - 5 * DAY },
    ], [], NOW);
    expect(matchContacts(ranked, "a", 5).map(c => c.email)).toEqual(["ada@acme.com", "no-reply@acme.com", "noreply@alerts.acme.com"]);
    expect(matchContacts(ranked, "", 1).map(c => c.email)).toEqual(["ada@acme.com"]);
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
