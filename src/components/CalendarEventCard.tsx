import { For, Show, type Component } from "solid-js";
import type { CalendarEvent } from "../api/tauri";
import { formatCalendarEventDate } from "../utils";
import { ClockIcon, LocationIcon, PeopleIcon } from "./Icons";

export interface CalendarEventCardProps {
  event: CalendarEvent;
  eventId: string; // For RSVP tracking (thread ID or calendar event ID)
  compact?: boolean;
  showTitle?: boolean;
  showAttendees?: boolean;
  rsvpStatus?: string;
  rsvpLoading?: boolean;
  onRsvp?: (status: "yes" | "maybe" | "no") => void;
}

export const CalendarEventCard: Component<CalendarEventCardProps> = (props) => {
  const isRequest = () => props.event.method === "REQUEST" && props.event.uid;
  const needsResponse = () => !props.rsvpStatus || props.rsvpStatus === "needsAction";

  return (
    <div class={`calendar-event-card ${props.compact ? 'compact' : ''}`}>
      <Show when={props.showTitle && props.event.title}>
        <div class="calendar-event-title">{props.event.title}</div>
      </Show>

      <div class="calendar-event-time">
        <ClockIcon />
        <span>
          {formatCalendarEventDate(
            props.event.start_time,
            props.event.end_time,
            props.event.all_day
          )}
        </span>
      </div>

      <Show when={props.event.location}>
        <div class="calendar-event-location">
          <LocationIcon />
          <span>{props.event.location}</span>
        </div>
      </Show>

      <Show when={props.event.description}>
        <div class="calendar-event-description">{props.event.description}</div>
      </Show>

      <Show when={props.showAttendees && props.event.attendees.length > 0}>
        <div class="calendar-event-attendees">
          <PeopleIcon />
          <div class="attendee-list">
            <For each={props.event.attendees}>
              {(attendee) => <span class="attendee">{attendee}</span>}
            </For>
          </div>
        </div>
      </Show>

      <Show when={props.event.status === "CANCELLED"}>
        <div class="calendar-event-status cancelled">Cancelled</div>
      </Show>

      <Show when={isRequest() && props.onRsvp}>
        <div class="calendar-rsvp" onClick={(e) => e.stopPropagation()}>
          <Show when={needsResponse()}>
            <span class="rsvp-prompt">RSVP:</span>
          </Show>
          <button
            class={props.rsvpStatus === "accepted" ? "selected" : ""}
            disabled={props.rsvpLoading}
            onClick={() => props.onRsvp?.("yes")}
          >
            Yes
          </button>
          <button
            class={props.rsvpStatus === "tentative" ? "selected" : ""}
            disabled={props.rsvpLoading}
            onClick={() => props.onRsvp?.("maybe")}
          >
            Maybe
          </button>
          <button
            class={props.rsvpStatus === "declined" ? "selected" : ""}
            disabled={props.rsvpLoading}
            onClick={() => props.onRsvp?.("no")}
          >
            No
          </button>
        </div>
      </Show>

      <Show when={!isRequest() && props.rsvpStatus && props.rsvpStatus !== "needsAction"}>
        <div class={`calendar-event-response ${props.rsvpStatus}`}>
          {props.rsvpStatus === "accepted" && "Going"}
          {props.rsvpStatus === "tentative" && "Maybe"}
          {props.rsvpStatus === "declined" && "Not going"}
        </div>
      </Show>
    </div>
  );
};

export default CalendarEventCard;
