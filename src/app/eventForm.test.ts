import { describe, expect, it } from "vitest";
import { eventAttendees, eventTimesFromForm, smartEventDefaults } from "./eventForm";

const form = (over: Partial<Parameters<typeof eventTimesFromForm>[0]> = {}) => ({
  startDate: "2026-03-11", startTime: "10:00",
  endDate: "2026-03-11", endTime: "10:30",
  allDay: false,
  ...over,
});

describe("eventTimesFromForm", () => {
  it("reads timed events in local time", () => {
    expect(eventTimesFromForm(form())).toEqual({
      start: new Date(2026, 2, 11, 10, 0).getTime(),
      end: new Date(2026, 2, 11, 10, 30).getTime(),
    });
  });

  it("anchors all-day dates at UTC noon so the backend's date is the chosen day", () => {
    expect(eventTimesFromForm(form({ allDay: true, endDate: "2026-03-13" }))).toEqual({
      start: Date.UTC(2026, 2, 11, 12),
      end: Date.UTC(2026, 2, 13, 12),
    });
  });

  it("allows a single-day all-day event", () => {
    expect(eventTimesFromForm(form({ allDay: true }))).not.toHaveProperty("error");
  });

  it("rejects a timed event that ends before it starts", () => {
    expect(eventTimesFromForm(form({ endTime: "09:00" }))).toEqual({ error: "End must be after start" });
  });

  it("rejects an all-day event whose last day is before its first", () => {
    expect(eventTimesFromForm(form({ allDay: true, endDate: "2026-03-10" }))).toEqual({ error: "End must be after start" });
  });

  it("rejects missing dates or times instead of sending NaN", () => {
    expect(eventTimesFromForm(form({ startDate: "" }))).toEqual({ error: "Enter a valid start and end" });
    expect(eventTimesFromForm(form({ endTime: "" }))).toEqual({ error: "Enter a valid start and end" });
    expect(eventTimesFromForm(form({ allDay: true, endDate: "" }))).toEqual({ error: "Enter a valid start and end" });
  });
});

describe("smartEventDefaults", () => {
  it("rounds up to the next half hour and lasts 30 minutes", () => {
    expect(smartEventDefaults(new Date(2026, 2, 11, 9, 10))).toEqual({ date: "2026-03-11", startTime: "09:30", endTime: "10:00" });
    expect(smartEventDefaults(new Date(2026, 2, 11, 9, 45))).toEqual({ date: "2026-03-11", startTime: "10:00", endTime: "10:30" });
  });

  it("moves to the next day when rounding passes midnight", () => {
    expect(smartEventDefaults(new Date(2026, 2, 11, 23, 40))).toEqual({ date: "2026-03-12", startTime: "00:00", endTime: "00:30" });
  });
});

describe("eventAttendees", () => {
  it("keeps a display name with a comma as one guest", () => {
    expect(eventAttendees('"Doe, John" <john@x.com>, ana@y.com')).toEqual(["john@x.com", "ana@y.com"]);
  });

  it("ignores empty entries", () => {
    expect(eventAttendees(" , ana@y.com, ")).toEqual(["ana@y.com"]);
    expect(eventAttendees("")).toEqual([]);
  });
});
