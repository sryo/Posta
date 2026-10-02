import { For, Show, untrack, type JSX } from "solid-js";

export type StripBox = { left: number; width: number };
export type StripBusy = StripBox & { title: string; overlap: boolean };

// Hours of one day drawn left to right, in percent of the track: hour ticks
// (noon heavier), the part already past, the user's other events (clashes
// hatched amber), the event's own slot and a now-line.
//   sm  a thin strip under an invite row, only to look at
//   lg  the event form's timeline, titled busy blocks and hour labels
// The event form passes its own draggable `slot` and track handlers; an
// invite row's slot is a plain outline.
export function DayStrip(props: {
  size: "sm" | "lg";
  ticks: number[];
  noonAt?: number | null;
  past?: number | null;
  nowAt?: number | null;
  busy: StripBusy[];
  slotBox: StripBox;
  // Built once and given its place as it changes, so a block being dragged
  // stays the same element under the pointer
  slot?: (style: () => JSX.CSSProperties) => JSX.Element;
  hours?: { at: number; label: string }[];
  trackRef?: (el: HTMLDivElement) => void;
  onTrackPointerDown?: (e: PointerEvent) => void;
  onWheel?: (e: WheelEvent) => void;
}) {
  const box = (b: StripBox): JSX.CSSProperties => ({ left: `${b.left}%`, width: `${b.width}%` });
  return (
    <div class="day-strip" data-size={props.size} aria-hidden={props.slot ? undefined : "true"}>
      <div
        ref={props.trackRef}
        class="day-strip-track"
        onPointerDown={(e) => props.onTrackPointerDown?.(e)}
        onWheel={(e) => props.onWheel?.(e)}
      >
        <For each={props.ticks}>{(at) => <span class="day-strip-tick" style={{ left: `${at}%` }} />}</For>
        <Show when={props.noonAt != null}>
          <span class="day-strip-tick noon" style={{ left: `${props.noonAt}%` }} />
        </Show>
        <Show when={props.past != null && props.past > 0}>
          <span class="day-strip-past" style={{ width: `${props.past}%` }} />
        </Show>
        <For each={props.busy}>
          {(block) => (
            <span class="day-strip-busy" classList={{ "overlap": block.overlap }} style={box(block)} title={block.title}>
              {props.size === "lg" ? block.title : ""}
            </span>
          )}
        </For>
        {props.slot ? untrack(() => props.slot!(() => box(props.slotBox))) : <span class="day-strip-slot" style={box(props.slotBox)} />}
        <Show when={props.nowAt != null}>
          <span class="day-strip-now" style={{ left: `${props.nowAt}%` }} />
        </Show>
      </div>
      <Show when={props.hours}>
        {(hours) => (
          <div class="day-strip-hours" aria-hidden="true">
            <For each={hours()}>{(hour) => <span style={{ left: `${hour.at}%` }}>{hour.label}</span>}</For>
          </div>
        )}
      </Show>
    </div>
  );
}
