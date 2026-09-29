import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCalendarId, lastUsedCalendar, rememberCalendar } from "./eventCalendars";

const cal = (id: string, access_role: string, is_primary = false) => ({ id, name: id, is_primary, access_role });

const calendars = [cal("me@x.test", "owner", true), cal("birthdays", "reader"), cal("team", "writer")];

describe("defaultCalendarId", () => {
  it("picks the calendar used last when the user can still write to it", () => {
    expect(defaultCalendarId(calendars, "team")).toBe("team");
  });

  it("falls back to the primary calendar", () => {
    expect(defaultCalendarId(calendars, null)).toBe("me@x.test");
    expect(defaultCalendarId(calendars, "birthdays")).toBe("me@x.test");
    expect(defaultCalendarId(calendars, "gone")).toBe("me@x.test");
  });

  it("falls back to any writable calendar, or none while calendars load", () => {
    expect(defaultCalendarId([cal("birthdays", "reader"), cal("team", "writer")], null)).toBe("team");
    expect(defaultCalendarId([], null)).toBeNull();
  });
});

describe("remembered calendar", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("remembers the last calendar per account", () => {
    rememberCalendar("acc-1", "team");
    rememberCalendar("acc-2", "other");
    expect(lastUsedCalendar("acc-1")).toBe("team");
    expect(lastUsedCalendar("acc-2")).toBe("other");
    expect(lastUsedCalendar("acc-3")).toBeNull();
  });

  it("works without storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => rememberCalendar("acc-1", "team")).not.toThrow();
    expect(lastUsedCalendar("acc-1")).toBeNull();
  });
});
