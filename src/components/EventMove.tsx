import { Portal } from "solid-js/web";
import type { DraggedEvent, DragVerdict } from "../app/eventDrag";

// What a day or free stretch says while an event is held over it
export const MoveVerdict = (props: { verdict: DragVerdict }) => (
  <span class="move-verdict" classList={{ clash: !props.verdict.free }} role="status">{props.verdict.text}</span>
);

// The event's row in small, following the pointer while it is dragged
export const EventDragGhost = (props: { dragged: DraggedEvent; time: string }) => (
  <Portal>
    <div class="event-drag-ghost" aria-hidden="true" style={{ transform: `translate(${props.dragged.x}px, ${props.dragged.y}px)` }}>
      <span class="event-drag-ghost-title">{props.dragged.event.title}</span>
      <span class="event-drag-ghost-time">{props.time}</span>
    </div>
  </Portal>
);
