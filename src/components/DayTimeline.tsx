import { createComputed, createSignal, untrack } from "solid-js";
import { DayStrip } from "./DayStrip";
import type { StripEvent } from "../app/dayStrip";
import { dragTo, firstHourFor, minuteAt, nudge, panFirstHour, percentOf, VISIBLE_HOURS, type Drag, type MinuteSpan } from "../app/dayTimeline";
import { formatTime, minutesToTime } from "../app/timeInput";

const MINUTE_MS = 60_000;
const LABEL_EVERY_HOURS = 3;

// Twelve hours of `day` with the user's other events, where the new event is
// placed by clicking, drawn by dragging, moved and resized by its edges, or
// stepped with the arrow keys
export function DayTimeline(props: {
  day: Date;
  slot: MinuteSpan;
  onChange: (slot: MinuteSpan) => void;
  busy?: StripEvent[];
  clashing?: StripEvent[];
  now: number;
  onDayShift?: (days: number) => void;
  onToday?: () => void;
}) {
  const [view, setView] = createSignal(firstHourFor(props.slot));
  // The slot as the pointer has it mid-drag, to the minute; the form only
  // hears of it in 15-minute steps
  const [live, setLive] = createSignal<MinuteSpan | null>(null);
  // Just let go: the slot slides from where the pointer left it to its step
  const [settling, setSettling] = createSignal(false);
  // Keeps the slot in view as it moves, without jumping while it fits or
  // while it's being dragged
  createComputed(() => {
    const slot = props.slot;
    if (untrack(live)) return;
    setView(hour => firstHourFor(slot, hour));
  });

  const dayStart = () => props.day.getTime();
  const minuteOf = (time: number) => (time - dayStart()) / MINUTE_MS;
  const pct = (minutes: number) => percentOf(minutes, view());
  const boxOf = (span: MinuteSpan) => ({ left: pct(span.start), width: pct(span.end) - pct(span.start) });

  const hours = () => Array.from({ length: VISIBLE_HOURS / LABEL_EVERY_HOURS + 1 }, (_, i) => view() + i * LABEL_EVERY_HOURS);
  const nowMinute = () => {
    const m = minuteOf(props.now);
    return m >= view() * 60 && m <= (view() + VISIBLE_HOURS) * 60 ? m : null;
  };
  const pastMinute = () => {
    const m = minuteOf(props.now);
    return m <= view() * 60 ? null : Math.min(m, (view() + VISIBLE_HOURS) * 60);
  };
  const isClash = (event: StripEvent) => props.clashing?.includes(event) ?? false;

  let track: HTMLDivElement | undefined;
  const minuteUnder = (clientX: number, step?: number): number | null => {
    const rect = track?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return minuteAt((clientX - rect.left) / rect.width, view(), step);
  };

  // A press on the slot moves it, on an edge resizes it, and on the track
  // draws a new one; a press that never moves places the slot there
  const startDrag = (kind: Drag, e: PointerEvent) => {
    if (e.button !== 0) return;
    const anchor = minuteUnder(e.clientX);
    const exactAnchor = minuteUnder(e.clientX, 0);
    if (anchor === null || exactAnchor === null) return;
    e.preventDefault();
    e.stopPropagation();
    const origin = { ...props.slot };
    const startX = e.clientX;
    let moved = false;
    let last = origin;
    const target = e.currentTarget as HTMLElement;
    // Keeps the drag when the pointer leaves the block; a pointer that is
    // already gone can't be captured, and the drag goes on without it
    try { target.setPointerCapture?.(e.pointerId); } catch { /* released already */ }
    setSettling(false);
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 2) return;
      const at = minuteUnder(ev.clientX);
      const exactAt = minuteUnder(ev.clientX, 0);
      if (at === null || exactAt === null) return;
      moved = true;
      setLive(dragTo(kind, origin, exactAnchor, exactAt, 0));
      const snapped = dragTo(kind, origin, anchor, at);
      if (snapped.start !== last.start || snapped.end !== last.end) {
        last = snapped;
        props.onChange(snapped);
      }
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      if (moved) {
        setSettling(true);
        setLive(null);
        setView(hour => firstHourFor(props.slot, hour));
      } else if (kind === "draw") props.onChange(dragTo("move", origin, origin.start, anchor));
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  let wheelDelta = 0;
  const onWheel = (e: WheelEvent) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    wheelDelta += delta;
    if (Math.abs(wheelDelta) < 40) return;
    e.preventDefault();
    setView(panFirstHour(view(), Math.sign(wheelDelta)));
    wheelDelta = 0;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const step = e.key === "ArrowRight" ? 1 : -1;
      e.preventDefault();
      e.stopPropagation();
      if (e.altKey) props.onDayShift?.(step);
      else props.onChange(nudge(props.slot, step, e.shiftKey));
    } else if ((e.key === "t" || e.key === "T") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      props.onToday?.();
    }
  };

  const slotText = () => `${formatTime(minutesToTime(props.slot.start % (24 * 60)))} to ${formatTime(minutesToTime(Math.min(props.slot.end, 24 * 60 - 1)))}`;

  return (
    <DayStrip
      size="lg"
      ticks={hours().slice(1, -1).map(hour => pct(hour * 60))}
      past={pastMinute() === null ? null : pct(pastMinute()!)}
      nowAt={nowMinute() === null ? null : pct(nowMinute()!)}
      busy={(props.busy ?? []).map(event => ({ ...boxOf({ start: minuteOf(event.start), end: minuteOf(event.end) }), title: event.title, overlap: isClash(event) }))}
      slotBox={boxOf(live() ?? props.slot)}
      hours={hours().map(hour => ({ at: pct(hour * 60), label: formatTime(minutesToTime(hour % 24 * 60)).replace(/:00/, "") }))}
      trackRef={(el) => { track = el; }}
      onTrackPointerDown={(e) => startDrag("draw", e)}
      onWheel={onWheel}
      slot={(style) => (
        <div
          class="day-strip-slot"
          classList={{ "dragging": live() !== null, "settling": settling() }}
          style={style()}
          onTransitionEnd={() => setSettling(false)}
          tabindex="0"
          role="slider"
          aria-label="Event time. Arrow keys move it, Shift with arrows changes its length, Option with arrows changes the day"
          aria-valuemin={0}
          aria-valuemax={24 * 60}
          aria-valuenow={props.slot.start}
          aria-valuetext={slotText()}
          onPointerDown={(e) => startDrag("move", e)}
          on:keydown={onKeyDown}
        >
          <span class="day-strip-handle start" onPointerDown={(e) => startDrag("start", e)} />
          <span class="day-strip-handle end" onPointerDown={(e) => startDrag("end", e)} />
        </div>
      )}
    />
  );
}
