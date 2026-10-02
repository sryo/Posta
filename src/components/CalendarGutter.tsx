import { Show } from "solid-js";
import type { GoogleCalendarEvent } from "../api/tauri";
import type { DragVerdict } from "../app/eventDrag";
import { dayNoteText, gutterStrip, gutterText, type DayNote, type Gutter } from "../app/gutters";
import { DayStrip } from "./DayStrip";
import { MoveVerdict } from "./EventMove";

// A free stretch between a day's events: its words over a thin strip of the
// day, `events` as busy blocks and the stretch outlined. Not a row: it takes
// no focus and keyboard navigation passes over it. An event dragged over it
// starts there, and `verdict` says whether it is free.
export const CalendarGutter = (props: { gutter: Gutter; events: GoogleCalendarEvent[]; now: number; locale?: string; moveTarget?: string; verdict?: DragVerdict | null }) => {
  const text = () => gutterText(props.gutter, props.now, props.locale);
  const strip = () => gutterStrip(props.gutter, props.events, props.now);
  return (
    <div
      class={props.gutter.ending ? "calendar-gutter ending" : "calendar-gutter"}
      classList={{ "move-over": !!props.verdict }}
      role="note"
      data-move-target={props.moveTarget}
    >
      <div class="calendar-gutter-words">
        <span class="calendar-gutter-line">{text().line}</span>
        <Show when={props.verdict} fallback={
          <Show when={text().length}>
            {(length) => <span class="calendar-gutter-length">{length()}</span>}
          </Show>
        }>
          {(verdict) => <MoveVerdict verdict={verdict()} />}
        </Show>
      </div>
      <DayStrip
        size="xs"
        ticks={strip().ticks}
        noonAt={strip().noonAt}
        past={strip().past}
        nowAt={strip().nowAt}
        busy={strip().busy}
        slotBox={strip().slotBox}
      />
    </div>
  );
};

// The first one of the morning, the last one, or the day being over: a line
// between rows in a gutter's words, without its strip
export const CalendarDayNote = (props: { note: DayNote; locale?: string }) => (
  <div class="calendar-day-note" role="note">{dayNoteText(props.note, props.locale)}</div>
);
