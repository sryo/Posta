import { describe, expect, it } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { CalendarDayNote, CalendarGutter } from "./CalendarGutter";
import type { Gutter } from "../app/gutters";

const at = (h: number, m = 0) => new Date(2026, 9, 1, h, m).getTime();
const lunch: Gutter = { beforeIndex: 2, start: at(12), end: at(15, 30), ending: false, nowAt: null };

describe("CalendarGutter", () => {
  it("names a free stretch ahead and its length, with no now-mark", () => {
    render(() => <CalendarGutter gutter={lunch} now={at(9, 15)} locale="en-US" />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Free 12:00 – 3:30 PM3 and a half hours");
    expect(note.querySelector(".calendar-gutter-now")).toBeNull();
  });

  it("slides a now-mark along the gap now is inside", () => {
    render(() => <CalendarGutter gutter={{ ...lunch, nowAt: 0.25 }} now={at(12, 52)} locale="en-US" />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Free until 3:30 PM2 hours and 40 minutes left");
    expect(note.querySelector<HTMLElement>(".calendar-gutter-now")?.style.left).toBe("25%");
  });

  it("marks now at the very start of the gap", () => {
    render(() => <CalendarGutter gutter={{ ...lunch, nowAt: 0 }} now={at(12)} locale="en-US" />);
    expect(screen.getByRole("note").querySelector<HTMLElement>(".calendar-gutter-now")?.style.left).toBe("0%");
  });

  it("says the afternoon is free, alone, at the end of the day", () => {
    render(() => <CalendarGutter gutter={{ ...lunch, end: at(18), ending: true }} now={at(9)} locale="en-US" />);
    const note = screen.getByRole("note");
    expect(note).toHaveClass("ending");
    expect(note).toHaveTextContent(/^Afternoon's free\.$/);
  });
});

describe("CalendarDayNote", () => {
  it("says the note plainly, as a note keyboard navigation passes over", () => {
    render(() => <CalendarDayNote note={{ beforeIndex: 0, kind: "first", at: at(9, 30) }} locale="en-US" />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(/^First one at 9:30 AM$/);
    expect(note).toHaveClass("calendar-day-note");
    expect(note).not.toHaveClass("calendar-gutter");
    expect(note.hasAttribute("tabindex")).toBe(false);
  });
});
