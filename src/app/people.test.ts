import { describe, expect, it } from "vitest";
import { organizerName, personName } from "./people";

describe("personName", () => {
  it("prefers a display name, falling back to the address", () => {
    expect(personName("Ana Pérez <ana@x.com>")).toBe("Ana Pérez");
    expect(personName('"Stone, Bob" <bob@x.com>')).toBe("Stone, Bob");
    expect(personName("lucas@x.com")).toBe("lucas@x.com");
  });
});

describe("organizerName", () => {
  const attendee = (email: string, display_name: string | null, is_organizer = false) =>
    ({ email, display_name, is_organizer, is_self: false, response_status: null });

  it("names the organizer from the guest list", () => {
    expect(organizerName({ organizer: "jules@x.com", attendees: [attendee("ana@x.com", "Ana"), attendee("JULES@x.com", "Jules Martin")] })).toBe("Jules Martin");
    expect(organizerName({ organizer: "team@x.com", attendees: [attendee("ana@x.com", "Ana", true)] })).toBe("team@x.com");
  });

  it("keeps the address when the guest list has no name for it", () => {
    expect(organizerName({ organizer: "jules@x.com", attendees: [attendee("jules@x.com", null, true)] })).toBe("jules@x.com");
    expect(organizerName({ organizer: null, attendees: [] })).toBeNull();
  });
});
