import { describe, expect, it } from "vitest";
import { formatTime, parseTimeInput, shiftTime, timeSteps } from "./timeInput";

describe("parseTimeInput", () => {
  it("reads 24-hour times, with or without a separator", () => {
    expect(parseTimeInput("15:30")).toBe("15:30");
    expect(parseTimeInput("9:05")).toBe("09:05");
    expect(parseTimeInput("9.30")).toBe("09:30");
    expect(parseTimeInput("1530")).toBe("15:30");
    expect(parseTimeInput("930")).toBe("09:30");
    expect(parseTimeInput("15")).toBe("15:00");
    expect(parseTimeInput("0")).toBe("00:00");
  });

  it("reads 12-hour times in the ways people type them", () => {
    expect(parseTimeInput("3pm")).toBe("15:00");
    expect(parseTimeInput("3 PM")).toBe("15:00");
    expect(parseTimeInput("3:30 p.m.")).toBe("15:30");
    expect(parseTimeInput("11a")).toBe("11:00");
    expect(parseTimeInput("12am")).toBe("00:00");
    expect(parseTimeInput("12 pm")).toBe("12:00");
    expect(parseTimeInput(" 7:45am ")).toBe("07:45");
  });

  it("rejects what isn't a time of day", () => {
    for (const text of ["", "abc", "25:00", "12:60", "13pm", "0am", "9:5", "12345"]) {
      expect(parseTimeInput(text), text).toBeNull();
    }
  });
});

describe("timeSteps", () => {
  it("steps through the day every 15 minutes", () => {
    const steps = timeSteps();
    expect(steps).toHaveLength(96);
    expect(steps.slice(0, 3)).toEqual(["00:00", "00:15", "00:30"]);
    expect(steps[steps.length - 1]).toBe("23:45");
  });

  it("keeps a time off the grid in order, so it stays selectable", () => {
    const steps = timeSteps("10:41");
    expect(steps.slice(steps.indexOf("10:30"), steps.indexOf("10:30") + 3)).toEqual(["10:30", "10:41", "10:45"]);
    expect(steps).toHaveLength(97);
  });
});

describe("formatTime", () => {
  it("formats a time in the given locale's style", () => {
    expect(formatTime("15:30", "en-US")).toMatch(/^3:30\sPM$/);
    expect(formatTime("15:30", "de-DE")).toBe("15:30");
    expect(formatTime("09:05", "en-GB")).toBe("09:05");
  });
});

describe("shiftTime", () => {
  it("moves by whole steps and stays within the day", () => {
    expect(shiftTime("10:00", 15)).toBe("10:15");
    expect(shiftTime("10:41", 15)).toBe("10:45");
    expect(shiftTime("10:41", -15)).toBe("10:30");
    expect(shiftTime("23:45", 15)).toBe("23:45");
    expect(shiftTime("00:00", -15)).toBe("00:00");
  });
});
