import { describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render } from "@solidjs/testing-library";
import { DayTimeline } from "./DayTimeline";
import type { MinuteSpan } from "../app/dayTimeline";

const DAY = new Date(2026, 9, 2).getTime();

// Twelve hours from 8 a.m. over a 720px track: one pixel a minute, 8 a.m. at 0
function renderTimeline(start: MinuteSpan) {
  const [slot, setSlot] = createSignal(start);
  const changes: MinuteSpan[] = [];
  const result = render(() => (
    <DayTimeline
      day={new Date(DAY)}
      slot={slot()}
      onChange={(s) => { changes.push(s); setSlot(s); }}
      now={DAY}
    />
  ));
  const track = result.container.querySelector(".day-strip-track") as HTMLElement;
  track.getBoundingClientRect = () => ({ left: 0, top: 0, right: 720, bottom: 40, width: 720, height: 40, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const block = result.container.querySelector<HTMLElement>('[role="slider"]')!;
  return { block, changes, slot };
}

const leftOf = (el: HTMLElement) => parseFloat(el.style.left);
const at = (minute: number) => ((minute - 8 * 60) / 720) * 100;

describe("DayTimeline dragging", () => {
  it("follows the pointer minute by minute while moved, and settles on a 15-minute step when let go", () => {
    const { block, changes, slot } = renderTimeline({ start: 13 * 60, end: 13 * 60 + 45 });
    fireEvent.pointerDown(block, { button: 0, pointerId: 1, clientX: 310 });
    fireEvent.pointerMove(block, { pointerId: 1, clientX: 320 });
    expect(leftOf(block)).toBeCloseTo(at(13 * 60 + 10), 3);
    expect(changes).toEqual([]);

    fireEvent.pointerMove(block, { pointerId: 1, clientX: 330 });
    expect(leftOf(block)).toBeCloseTo(at(13 * 60 + 20), 3);
    expect(slot()).toEqual({ start: 13 * 60 + 15, end: 14 * 60 });

    fireEvent.pointerUp(block, { pointerId: 1, clientX: 330 });
    expect(block.isConnected).toBe(true);
    expect(leftOf(block)).toBeCloseTo(at(13 * 60 + 15), 3);
    expect(block).toHaveClass("settling");
  });

  it("follows an edge minute by minute while resized", () => {
    const { block, slot } = renderTimeline({ start: 13 * 60, end: 13 * 60 + 45 });
    const end = block.querySelector(".day-strip-handle.end") as HTMLElement;
    fireEvent.pointerDown(end, { button: 0, pointerId: 1, clientX: 345 });
    fireEvent.pointerMove(end, { pointerId: 1, clientX: 352 });
    expect(parseFloat(block.style.width)).toBeCloseTo((52 / 720) * 100, 3);
    expect(slot()).toEqual({ start: 13 * 60, end: 13 * 60 + 45 });
    fireEvent.pointerUp(end, { pointerId: 1, clientX: 352 });
    expect(slot()).toEqual({ start: 13 * 60, end: 13 * 60 + 45 });
    expect(parseFloat(block.style.width)).toBeCloseTo((45 / 720) * 100, 3);
  });
});
