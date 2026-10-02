import { Show } from "solid-js";
import type { DragVerdict } from "../app/eventDrag";
import { dayNoteText, gutterText, type DayNote, type Gutter } from "../app/gutters";
import { MoveVerdict } from "./EventMove";

// A free stretch between a day's events, perforated above and below like the
// gutter between two panes of a stamp sheet. Not a row: it takes no focus and
// keyboard navigation passes over it. An event dragged over it starts there,
// and `verdict` says whether it is free.
export const CalendarGutter = (props: { gutter: Gutter; now: number; locale?: string; moveTarget?: string; verdict?: DragVerdict | null }) => {
  const text = () => gutterText(props.gutter, props.now, props.locale);
  return (
    <div
      class={props.gutter.ending ? "calendar-gutter ending" : "calendar-gutter"}
      classList={{ "move-over": !!props.verdict }}
      role="note"
      data-move-target={props.moveTarget}
    >
      <Show when={props.gutter.nowAt !== null}>
        <span class="calendar-gutter-now" style={{ left: `${props.gutter.nowAt! * 100}%` }} aria-hidden="true" />
      </Show>
      <span class="calendar-gutter-line">{text().line}</span>
      <Show when={props.verdict} fallback={
        <Show when={text().length}>
          {(length) => <span class="calendar-gutter-length">{length()}</span>}
        </Show>
      }>
        {(verdict) => <MoveVerdict verdict={verdict()} />}
      </Show>
    </div>
  );
};

// The first one of the morning, the last one, or the day being over: a line
// between rows like a gutter's, without its perforations
export const CalendarDayNote = (props: { note: DayNote; locale?: string }) => (
  <div class="calendar-day-note" role="note">{dayNoteText(props.note, props.locale)}</div>
);
