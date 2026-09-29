import { describe, expect, it } from "vitest";
import { nameInThreads, organizerName, participantNames, personName } from "./people";

describe("personName", () => {
  it("prefers a display name, falling back to the address", () => {
    expect(personName("Ana Pérez <ana@x.com>")).toBe("Ana Pérez");
    expect(personName('"Stone, Bob" <bob@x.com>')).toBe("Stone, Bob");
    expect(personName("lucas@x.com")).toBe("lucas@x.com");
  });
});

describe("participantNames", () => {
  it("names the people on a thread, the user as me", () => {
    expect(participantNames(["mateo@posta.test", "Ana Pérez <ana@x.com>"], ["MATEO@posta.test"])).toBe("me, Ana Pérez");
  });

  it("counts the people past the first three", () => {
    expect(participantNames(["a@x.com", "Bo <b@x.com>", "c@x.com", "d@x.com", "e@x.com"], [])).toBe("a@x.com, Bo, c@x.com + 2");
  });
});

describe("nameInThreads", () => {
  it("finds the display name the loaded mail gives an address", () => {
    const threads = [{ participants: ["lucas@acme.test"] }, { participants: ["Ana <ana@x.com>", "Lucas Romero <LUCAS@acme.test>"] }];
    expect(nameInThreads("lucas@acme.test", threads)).toBe("Lucas Romero");
    expect(nameInThreads("bo@x.com", threads)).toBeUndefined();
  });
});

describe("organizerName", () => {
  const attendee = (email: string, display_name: string | null, is_organizer = false) =>
    ({ email, display_name, is_organizer, is_self: false, response_status: null });

  it("names the organizer from the guest list", () => {
    expect(organizerName({ organizer: "jules@x.com", attendees: [attendee("ana@x.com", "Ana"), attendee("JULES@x.com", "Jules Martin")] })).toBe("Jules Martin");
    expect(organizerName({ organizer: "team@x.com", attendees: [attendee("ana@x.com", "Ana", true)] })).toBe("team@x.com");
  });

  it("calls the signed-in user's own events theirs", () => {
    expect(organizerName({ organizer: "Mateo@posta.test", attendees: [] }, "mateo@posta.test")).toBe("You");
    expect(organizerName({ organizer: "jules@x.com", attendees: [] }, "mateo@posta.test")).toBe("jules@x.com");
  });

  it("falls back to a name the user's mail knows for the organizer", () => {
    const known = (email: string) => (email === "lucas@acme.test" ? "Lucas Romero" : undefined);
    expect(organizerName({ organizer: "Lucas@acme.test", attendees: [] }, "me@x.com", known)).toBe("Lucas Romero");
    expect(organizerName({ organizer: "team@x.com", attendees: [] }, "me@x.com", known)).toBe("team@x.com");
  });

  it("keeps the address when the guest list has no name for it", () => {
    expect(organizerName({ organizer: "jules@x.com", attendees: [attendee("jules@x.com", null, true)] })).toBe("jules@x.com");
    expect(organizerName({ organizer: null, attendees: [] })).toBeNull();
  });
});
