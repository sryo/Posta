import { describe, expect, it } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { CalendarDayNote, CalendarGutter } from "./CalendarGutter";
import type { Gutter } from "../app/gutters";

const at = (h: number, m = 0) => new Date(2026, 9, 1, h, m).getTime();
const lunch: Gutter = { beforeIndex: 2, start: at(12), end: at(15, 30), ending: false, nowAt: null };

describe("CalendarGutter", () => {
  it("names a free stretch ahead and its length, over a day strip with the stretch outlined", () => {
    render(() => <CalendarGutter gutter={lunch} events={[]} now={at(9, 15)} locale="en-US" />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Free 12:00 – 3:30 PM3 and a half hours");
    const strip = note.querySelector(".day-strip")!;
    expect(strip).toHaveAttribute("data-size", "xs");
    expect(strip).toHaveAttribute("aria-hidden", "true");
    expect(strip.querySelector<HTMLElement>(".day-strip-slot")?.style.left).toBe("40%");
    expect(strip.querySelector<HTMLElement>(".day-strip-slot")?.style.width).toBe("35%");
    expect(note.querySelector(".day-strip-now")).not.toBeNull();
  });

  it("draws now on the strip while now is inside the gap, with no perforated now-mark", () => {
    render(() => <CalendarGutter gutter={{ ...lunch, nowAt: 0.25 }} events={[]} now={at(12, 52)} locale="en-US" />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Free until 3:30 PM2 hours and 40 minutes left");
    expect(note.querySelector(".calendar-gutter-now")).toBeNull();
    expect(parseFloat(note.querySelector<HTMLElement>(".day-strip-now")!.style.left)).toBeCloseTo((292 / 600) * 100, 3);
  });

  it("says whether an event held over it is free there, in place of its length", () => {
    render(() => <CalendarGutter gutter={lunch} events={[]} now={at(9)} locale="en-US" verdict={{ free: false, text: "clashes with Lunch, 12:30 PM" }} />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(/^Free 12:00 – 3:30 PMclashes with Lunch, 12:30 PM$/);
    expect(note).toHaveClass("move-over");
    expect(screen.getByRole("status")).toHaveClass("clash");
  });

  it("says the afternoon is free, alone, at the end of the day", () => {
    render(() => <CalendarGutter gutter={{ ...lunch, end: at(18), ending: true }} events={[]} now={at(9)} locale="en-US" />);
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
