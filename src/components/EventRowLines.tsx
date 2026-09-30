import { Show, type JSX } from "solid-js";
import type { GoogleCalendarEvent } from "../api/tauri";
import { ownResponseLabel } from "../app/rsvp";
import { LocationIcon } from "./Icons";

// What an event row says, the same in a calendar card and in a new card's
// preview: its title and when, what it's about, where, and the user's
// answer when they have one to give. A card's row adds Join in `children`.
export function EventRowLines(props: {
  event: GoogleCalendarEvent;
  time: string;
  showResponse: boolean;
  children?: JSX.Element;
}) {
  const e = () => props.event;
  return (
    <>
      <div class="calendar-event-row">
        <span class="calendar-event-title">{e().title}</span>
        <span class="calendar-event-time-compact">{props.time}</span>
      </div>
      <Show when={e().description}>
        <div class="calendar-event-description">{e().description}</div>
      </Show>
      <Show when={e().location}>
        <div class="calendar-event-location-compact">
          <LocationIcon size="meta" />
          <span>{e().location}</span>
        </div>
      </Show>
      <Show when={props.showResponse && e().response_status}>
        <div class={`calendar-event-response ${e().response_status}`}>
          {ownResponseLabel(e().response_status)}
        </div>
      </Show>
      {props.children}
    </>
  );
}
