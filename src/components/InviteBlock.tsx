import { Show } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CalendarEvent } from "../api/tauri";
import type { RsvpStatus } from "../app/rsvp";
import { formatCalendarEventDate } from "../utils";
import { ClockIcon, LocationIcon, VideoIcon } from "./Icons";
import { RsvpControl } from "./RsvpControl";

// An invite email's event: when and where, a Join button and the user's
// answer. The same block sits on the card row and above the opened email.
export const InviteBlock = (props: {
  invite: CalendarEvent;
  rsvp: string | null | undefined;
  onAnswer: (status: RsvpStatus) => void;
  disabled?: boolean;
  showTitle?: boolean;
  showKeys?: boolean;
  size?: "sm" | "md";
}) => {
  const answerable = () => props.invite.method === "REQUEST" && !!props.invite.uid;
  return (
    <div class="calendar-event-preview" classList={{ "invite-block-md": props.size === "md" }}>
      <Show when={props.showTitle}>
        <div class="calendar-event-title">{props.invite.title}</div>
      </Show>
      <div class="calendar-event-time">
        <ClockIcon size="meta" />
        <span>{formatCalendarEventDate(props.invite.start_time, props.invite.end_time, props.invite.all_day)}</span>
      </div>
      <Show when={props.invite.location}>
        <div class="calendar-event-location">
          <LocationIcon size="meta" />
          <span>{props.invite.location}</span>
        </div>
      </Show>
      <Show when={props.invite.conference_url || answerable()}>
        <div class="invite-actions">
          <Show when={props.invite.conference_url}>
            <button
              type="button"
              class="calendar-join-btn"
              onClick={(e) => { e.stopPropagation(); openUrl(props.invite.conference_url!); }}
            >
              <VideoIcon size="meta" />
              Join
            </button>
          </Show>
          <Show when={answerable()}>
            <RsvpControl
              size={props.size ?? "sm"}
              value={props.rsvp}
              disabled={props.disabled}
              showKeys={props.showKeys}
              onAnswer={props.onAnswer}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
};
