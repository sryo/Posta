import { Show } from "solid-js";
import { dayNoteText, gutterText, type DayNote, type Gutter } from "../app/gutters";

// A free stretch between a day's events, perforated above and below like the
// gutter between two panes of a stamp sheet. Not a row: it takes no focus and
// keyboard navigation passes over it.
export const CalendarGutter = (props: { gutter: Gutter; now: number; locale?: string }) => {
  const text = () => gutterText(props.gutter, props.now, props.locale);
  return (
    <div class={props.gutter.ending ? "calendar-gutter ending" : "calendar-gutter"} role="note">
      <Show when={props.gutter.nowAt !== null}>
        <span class="calendar-gutter-now" style={{ left: `${props.gutter.nowAt! * 100}%` }} aria-hidden="true" />
      </Show>
      <span class="calendar-gutter-line">{text().line}</span>
      <Show when={text().length}>
        {(length) => <span class="calendar-gutter-length">{length()}</span>}
      </Show>
    </div>
  );
};

// The first one of the morning, the last one, or the day being over: a line
// between rows like a gutter's, without its perforations
export const CalendarDayNote = (props: { note: DayNote; locale?: string }) => (
  <div class="calendar-day-note" role="note">{dayNoteText(props.note, props.locale)}</div>
);
