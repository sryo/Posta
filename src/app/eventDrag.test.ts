import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import type { GoogleCalendarEvent } from "../api/tauri";
import { createEventDrag } from "./eventDrag";

const at = (h: number, m = 0, day = 1) => new Date(2026, 9, day, h, m).getTime();
const FRIDAY = new Date(2026, 9, 2).getTime();

const standup = {
  id: "standup", calendar_id: "primary", calendar_name: "Work", title: "Standup", description: null, location: null,
  start_time: at(10), end_time: at(10, 30), all_day: false, status: "confirmed", organizer: null, attendees: [],
  html_link: null, hangout_link: null, response_status: "accepted", can_edit: true,
} satisfies GoogleCalendarEvent;

let card: HTMLElement;
let otherCard: HTMLElement;
let row: HTMLElement;
let joinButton: HTMLElement;
let friday: HTMLElement;
let today: HTMLElement;
let gutter: HTMLElement;
let under: Element | null;

function setUp(options: { refusal?: string | null } = {}) {
  const onDrop = vi.fn();
  const verdict = vi.fn((_event: GoogleCalendarEvent, start: number) => ({ free: true, text: `${new Date(start).getHours()}:00 is free` }));
  let dispose!: () => void;
  const drag = createRoot(d => {
    dispose = d;
    return createEventDrag({ verdict, refusal: () => options.refusal ?? null, onDrop });
  });
  return { drag, onDrop, verdict, dispose };
}

const pointer = (type: string, x: number, y: number, target: EventTarget = window, button = 0) => {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button });
  target.dispatchEvent(e);
  return e;
};
// Presses on the row as App's pointerdown handler hands it over
const press = (drag: ReturnType<typeof createEventDrag>, target: HTMLElement = row, button = 0) => {
  const e = new MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true, cancelable: true, button }) as PointerEvent;
  Object.defineProperty(e, "target", { value: target });
  drag.press(e, standup, "cal");
};

beforeEach(() => {
  document.body.innerHTML = `
    <div class="card-body" id="card">
      <div data-move-target="day:${new Date(2026, 9, 1).getTime()}" id="today">Today</div>
      <div class="calendar-event-item" id="row">Standup <button id="join">Join meeting</button></div>
      <div data-move-target="at:${at(12)}" id="gutter">Free 12:00 – 3:30 PM</div>
      <div data-move-target="day:${FRIDAY}" id="friday"><span id="friday-label">Tomorrow</span></div>
    </div>
    <div class="card-body" id="other"><div data-move-target="day:${FRIDAY}" id="other-friday">Tomorrow</div></div>`;
  card = document.getElementById("card")!;
  otherCard = document.getElementById("other")!;
  row = document.getElementById("row")!;
  joinButton = document.getElementById("join")!;
  friday = document.getElementById("friday")!;
  today = document.getElementById("today")!;
  gutter = document.getElementById("gutter")!;
  under = null;
  document.elementFromPoint = () => under;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("createEventDrag", () => {
  it("says on the day it's over, before letting go, whether that time is free", () => {
    const { drag, verdict, dispose } = setUp();
    press(drag);
    under = document.getElementById("friday-label");
    pointer("pointermove", 10, 40);

    expect(drag.dragged()?.event.id).toBe("standup");
    expect(drag.verdictAt(`day:${FRIDAY}`)).toEqual({ free: true, text: "10:00 is free" });
    expect(verdict).toHaveBeenLastCalledWith(standup, at(10, 0, 2), "cal");
    expect(drag.verdictAt(`at:${at(12)}`)).toBeNull();
    dispose();
  });

  it("moves it to the time the target offers on letting go", () => {
    const { drag, onDrop, dispose } = setUp();
    press(drag);
    under = friday;
    pointer("pointermove", 10, 40);
    pointer("pointerup", 10, 40);

    expect(onDrop).toHaveBeenCalledWith(standup, "cal", at(10, 0, 2));
    expect(drag.dragged()).toBeNull();
    dispose();
  });

  it("takes a free stretch's start as the new time", () => {
    const { drag, onDrop, dispose } = setUp();
    press(drag);
    under = gutter;
    pointer("pointermove", 10, 40);
    expect(drag.verdictAt(`at:${at(12)}`)?.text).toBe("12:00 is free");
    pointer("pointerup", 10, 40);
    expect(onDrop).toHaveBeenCalledWith(standup, "cal", at(12));
    dispose();
  });

  it("keeps the click that ends a drag from opening the row", () => {
    const { drag, dispose } = setUp();
    const opened = vi.fn();
    row.addEventListener("click", opened);
    press(drag);
    under = friday;
    pointer("pointermove", 10, 40);
    pointer("pointerup", 10, 40);
    row.click();
    expect(opened).not.toHaveBeenCalled();
    dispose();
  });

  it("lets a click outside the card through right after a drag", () => {
    const { drag, dispose } = setUp();
    const pressed = vi.fn();
    const undo = document.createElement("button");
    document.body.append(undo);
    undo.addEventListener("click", pressed);
    press(drag);
    under = friday;
    pointer("pointermove", 10, 40);
    pointer("pointerup", 10, 40);
    undo.click();
    expect(pressed).toHaveBeenCalledOnce();
    dispose();
  });

  it("is a click, not a drag, until the pointer travels a few pixels", () => {
    const { drag, onDrop, dispose } = setUp();
    const opened = vi.fn();
    row.addEventListener("click", opened);
    press(drag);
    under = friday;
    pointer("pointermove", 12, 12);
    expect(drag.dragged()).toBeNull();
    pointer("pointerup", 12, 12);
    row.click();
    expect(onDrop).not.toHaveBeenCalled();
    expect(opened).toHaveBeenCalledOnce();
    dispose();
  });

  it("says nothing over the day and time the event already has", () => {
    const { drag, onDrop, dispose } = setUp();
    press(drag);
    under = today;
    pointer("pointermove", 10, 40);
    expect(drag.verdictAt(`day:${new Date(2026, 9, 1).getTime()}`)).toBeNull();
    pointer("pointerup", 10, 40);
    expect(onDrop).not.toHaveBeenCalled();
    dispose();
  });

  it("only drops within its own card", () => {
    const { drag, onDrop, dispose } = setUp();
    press(drag);
    under = document.getElementById("other-friday");
    pointer("pointermove", 10, 40);
    expect(drag.verdictAt(`day:${FRIDAY}`)).toBeNull();
    pointer("pointerup", 10, 40);
    expect(onDrop).not.toHaveBeenCalled();
    expect(otherCard).toBeTruthy();
    dispose();
  });

  it("says why an event that can't move stays, and leaves it there", () => {
    const { drag, onDrop, dispose } = setUp({ refusal: "Only Lucía can move this" });
    press(drag);
    under = friday;
    pointer("pointermove", 10, 40);
    expect(drag.verdictAt(`day:${FRIDAY}`)).toEqual({ free: false, text: "Only Lucía can move this" });
    pointer("pointerup", 10, 40);
    expect(onDrop).not.toHaveBeenCalled();
    dispose();
  });

  it("puts it back on Escape", () => {
    const { drag, onDrop, dispose } = setUp();
    press(drag);
    under = friday;
    pointer("pointermove", 10, 40);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(drag.dragged()).toBeNull();
    pointer("pointerup", 10, 40);
    expect(onDrop).not.toHaveBeenCalled();
    dispose();
  });

  it("leaves presses on the row's own buttons, and other buttons than the main one, alone", () => {
    const { drag, dispose } = setUp();
    press(drag, joinButton);
    under = friday;
    pointer("pointermove", 10, 40);
    expect(drag.dragged()).toBeNull();
    press(drag, row, 2);
    pointer("pointermove", 10, 60);
    expect(drag.dragged()).toBeNull();
    dispose();
  });

  it("follows the pointer for the ghost", () => {
    const { drag, dispose } = setUp();
    press(drag);
    pointer("pointermove", 30, 50);
    expect(drag.dragged()).toMatchObject({ x: 30, y: 50 });
    expect(card.contains(row)).toBe(true);
    expect(document.body).toHaveClass("dragging-event");
    pointer("pointerup", 30, 50);
    expect(document.body).not.toHaveClass("dragging-event");
    dispose();
  });
});
