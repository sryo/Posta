import { Show } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CalendarEvent } from "../api/tauri";
import type { RsvpStatus } from "../app/rsvp";
import { stripHours, type StripLayout } from "../app/dayStrip";
import { shownLocation } from "../app/inviteRow";
import { formatTime, minutesToTime } from "../app/timeInput";
import { DayStrip } from "./DayStrip";
import { formatCalendarEventDate } from "../utils";
import { ClockIcon, LocationIcon, VideoIcon, WarningIcon } from "./Icons";
import { RsvpControl } from "./RsvpControl";

// An invite email's event above the opened email: when, the day around it
// with anything it clashes with, where, a Join button and the user's answer
const HOUR_TICKS = Array.from({ length: 11 }, (_, i) => ((i + 1) / 12) * 100);
const hourLabel = (hour: number) => formatTime(minutesToTime(hour * 60)).replace(/:00/, "");

export const InviteBlock = (props: {
  invite: CalendarEvent;
  rsvp: string | null | undefined;
  onAnswer: (status: RsvpStatus) => void;
  disabled?: boolean;
  showTitle?: boolean;
  showKeys?: boolean;
  size?: "sm" | "md";
  strip?: StripLayout | null;
}) => {
  const location = () => shownLocation(props.invite);
  const clashes = () => props.strip?.clashes ?? [];
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
      <Show when={props.strip}>
        {(layout) => (
          <DayStrip
            size="sm"
            ticks={HOUR_TICKS}
            noonAt={layout().noonAt}
            past={layout().past}
            nowAt={layout().nowAt}
            busy={layout().busy}
            slotBox={layout().slot}
            hours={stripHours(layout().window, hourLabel)}
          />
        )}
      </Show>
      <Show when={clashes().length > 0}>
        <div class="invite-block-clash">
          <WarningIcon size="meta" />
          <span>
            Clashes with <span class="invite-clash-title">{clashes()[0].title}</span>
            {clashes().length > 1 ? ` and ${clashes().length - 1} more` : ""}
          </span>
        </div>
      </Show>
      <Show when={location()}>
        <div class="calendar-event-location">
          <LocationIcon size="meta" />
          <span>{location()}</span>
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
