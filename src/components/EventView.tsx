import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import DOMPurify from 'dompurify';
import { DOMPURIFY_CONFIG } from './MessageBody';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { GoogleCalendarEvent } from "../api/tauri";
import { formatCalendarEventDate, getResponseStatusLabel } from "../utils";
import {
  ReplyIcon,
  TrashIcon,
  EditIcon,
  CalendarIcon,
  LocationIcon,
  VideoIcon,
} from "./Icons";
import { CloseButton } from "./ComposeAtoms";
import { ComposeForm } from "./ComposeForm";
import { CreateEventForm } from "./CreateEventForm";
import { MessageActionsWheel } from "./MessageActionsWheel";
import { COLOR_HEX } from "../shared/constants";
import type { InlineComposeProps, InlineEditEventProps } from "./types";

// Event View Component
export const EventView = (props: {
  event: GoogleCalendarEvent | null;
  card: { name: string; color: string | null } | null;
  focusColor: string | null;
  onClose: () => void;
  onRsvp: (status: "accepted" | "declined" | "tentative") => void;
  onReplyOrganizer: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenCalendars: () => void;
  calendarDrawerOpen: boolean;
  onCloseCalendarDrawer: () => void;
  calendars: { id: string; name: string; is_primary: boolean }[];
  calendarsLoading: boolean;
  onMoveToCalendar: (calendarId: string) => void;
  rsvpLoading: boolean;
  inlineCompose: InlineComposeProps | null;
  inlineEdit: InlineEditEventProps | null;
}) => {
  const [closing, setClosing] = createSignal(false);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => props.onClose(), 200);
  };

  // Toolbar shortcuts advertised by the shortcut-hint badges (R/J/O/C/E/#)
  const handleKeyDown = (e: KeyboardEvent) => {
    const isTyping = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';

    if (e.key === 'Escape') {
      if (isTyping) return; // input-level handlers (e.g. ComposeForm) own Escape
      if (props.inlineEdit) { props.inlineEdit.onClose(); return; }
      if (props.inlineCompose) { props.inlineCompose.onClose(); return; }
      if (props.calendarDrawerOpen) { props.onCloseCalendarDrawer(); return; }
      handleClose();
      return;
    }

    if (isTyping || !props.event || props.inlineCompose || props.inlineEdit) return;
    const event = props.event;

    if (e.key === 'r' && event.organizer) { e.preventDefault(); props.onReplyOrganizer(); return; }
    if (e.key === 'j' && event.hangout_link) { e.preventDefault(); openUrl(event.hangout_link); return; }
    if (e.key === 'o' && event.html_link) { e.preventDefault(); openUrl(event.html_link); return; }
    if (e.key === 'c') { e.preventDefault(); props.onOpenCalendars(); return; }
    if (e.key === 'e' && event.can_edit) { e.preventDefault(); props.onEdit(); return; }
    if ((e.key === 'd' || e.key === '#') && event.can_edit) { e.preventDefault(); props.onDelete(); return; }
  };

  onMount(() => document.addEventListener('keydown', handleKeyDown));
  onCleanup(() => document.removeEventListener('keydown', handleKeyDown));

  return (
    <div class={`thread-overlay ${closing() ? 'closing' : ''}`} style={props.focusColor ? { '--message-focused-color': props.focusColor } as any : undefined}>
      <div class="thread-floating-bar">
        {/* Row 1: Close + Title + Card indicator */}
        <div class="thread-floating-bar-row">
          <CloseButton onClick={handleClose} />
          <div class="thread-bar-subject">
            <Show when={props.event} fallback={<span>Loading...</span>}>
              <h2>{props.event?.title || '(No title)'}</h2>
            </Show>
          </div>
          <Show when={props.card}>
            <div
              class="thread-bar-card"
              style={props.card?.color ? {
                background: COLOR_HEX[props.card.color] + '20',
                color: COLOR_HEX[props.card.color]
              } : {
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)'
              }}
            >
              {props.card?.name}
            </div>
          </Show>
        </div>

        {/* Row 2: Actions */}
        <Show when={props.event}>
          <div class="thread-floating-bar-row thread-bar-actions">
            {/* Reply to organizer */}
            <Show when={props.event!.organizer}>
              <button
                class="thread-toolbar-btn"
                onClick={props.onReplyOrganizer}
                title="Reply to organizer"
              >
                <ReplyIcon />
                <span class="thread-toolbar-label">Reply</span>
                <span class="shortcut-hint">R</span>
              </button>
            </Show>

            <Show when={props.event!.hangout_link}>
              <div class="thread-toolbar-divider" />
              <button
                class="thread-toolbar-btn"
                onClick={() => props.event!.hangout_link && openUrl(props.event!.hangout_link)}
                title="Join video call"
              >
                <VideoIcon />
                <span class="thread-toolbar-label">Join</span>
                <span class="shortcut-hint">J</span>
              </button>
            </Show>

            <Show when={props.event!.html_link}>
              <button
                class="thread-toolbar-btn"
                onClick={() => props.event!.html_link && openUrl(props.event!.html_link)}
                title="Open in Google Calendar"
              >
                <CalendarIcon />
                <span class="thread-toolbar-label">Open</span>
                <span class="shortcut-hint">O</span>
              </button>
            </Show>

            <button class="thread-toolbar-btn" onClick={props.onOpenCalendars} title="Move to calendar">
              <CalendarIcon />
              <span class="thread-toolbar-label">Move</span>
              <span class="shortcut-hint">C</span>
            </button>

            <Show when={props.event!.can_edit}>
              <div class="thread-toolbar-divider" />

              <button
                class="thread-toolbar-btn"
                onClick={props.onEdit}
                title="Edit event"
              >
                <EditIcon />
                <span class="thread-toolbar-label">Edit</span>
                <span class="shortcut-hint">E</span>
              </button>

              <button
                class="thread-toolbar-btn thread-toolbar-btn-danger"
                onClick={props.onDelete}
                title="Delete event"
              >
                <TrashIcon />
                <span class="thread-toolbar-label">Delete</span>
                <span class="shortcut-hint">#</span>
              </button>
            </Show>
          </div>
        </Show>
      </div>

      <div class="thread-content">
        <Show when={props.event}>
          <div class="messages-list">
              <div class={`message-row ${props.inlineCompose || props.inlineEdit ? 'with-compose' : ''} ${props.inlineCompose?.resizing || props.inlineEdit?.resizing ? 'resizing' : ''}`}>
                <div class="message-card message-focused">
                  {/* Event Header */}
                  <div class="message-header">
                    <div class="message-sender">{props.event!.organizer || 'Unknown organizer'}</div>
                    <div class="message-date">{formatCalendarEventDate(props.event!.start_time, props.event!.end_time, props.event!.all_day)}</div>
                  </div>

                  {/* Message Actions Wheel - hide when composing or editing */}
                  <Show when={!props.inlineCompose && !props.inlineEdit}>
                    <MessageActionsWheel
                      onReply={props.onReplyOrganizer}
                      onReplyAll={props.onReplyAll}
                      onForward={props.onForward}
                      open={true}
                      showHints={true}
                    />
                  </Show>

                  {/* Calendar Name */}
                  <div class="event-info-row">
                    <CalendarIcon />
                    <span>{props.event!.calendar_name}</span>
                  </div>

                  {/* Location */}
                  <Show when={props.event!.location}>
                    <div class="event-info-row">
                      <LocationIcon />
                      <span>{props.event!.location}</span>
                    </div>
                  </Show>

                  {/* Video call */}
                  <Show when={props.event!.hangout_link}>
                    <div class="event-info-row">
                      <VideoIcon />
                      <a href="#" onClick={(e) => { e.preventDefault(); props.event!.hangout_link && openUrl(props.event!.hangout_link); }}>
                        Join video call
                      </a>
                    </div>
                  </Show>

                  {/* Description */}
                  <Show when={props.event!.description}>
                    <div class="message-body">
                      <div innerHTML={DOMPurify.sanitize(props.event!.description!.replace(/\n/g, '<br>'), DOMPURIFY_CONFIG)} />
                    </div>
                  </Show>

                  {/* RSVP Section */}
                  <Show when={props.event!.response_status}>
                    <div class="event-rsvp-section">
                      <div class="event-rsvp-current">
                        Your response: <span class={`event-rsvp-status ${props.event!.response_status}`}>
                          {getResponseStatusLabel(props.event!.response_status)}
                        </span>
                      </div>
                      <div class="event-rsvp-buttons">
                        <button
                          class={`event-rsvp-btn ${props.event!.response_status === 'accepted' ? 'active' : ''}`}
                          onClick={() => props.onRsvp('accepted')}
                          disabled={props.rsvpLoading}
                        >
                          Yes
                        </button>
                        <button
                          class={`event-rsvp-btn ${props.event!.response_status === 'tentative' ? 'active' : ''}`}
                          onClick={() => props.onRsvp('tentative')}
                          disabled={props.rsvpLoading}
                        >
                          Maybe
                        </button>
                        <button
                          class={`event-rsvp-btn ${props.event!.response_status === 'declined' ? 'active' : ''}`}
                          onClick={() => props.onRsvp('declined')}
                          disabled={props.rsvpLoading}
                        >
                          No
                        </button>
                      </div>
                    </div>
                  </Show>

                  {/* Attendees */}
                  <Show when={props.event!.attendees.length > 0}>
                    <div class="event-attendees-section">
                      <div class="event-attendees-label">{props.event!.attendees.length} guests</div>
                      <div class="event-attendees-list">
                        <For each={props.event!.attendees}>
                          {(attendee) => (
                            <div class={`event-attendee ${attendee.response_status || ''}`}>
                              <span class="event-attendee-name">
                                {attendee.display_name || attendee.email}
                                {attendee.is_organizer && <span class="event-attendee-badge">Organizer</span>}
                              </span>
                              <span class={`event-attendee-status ${attendee.response_status || ''}`}>
                                {getResponseStatusLabel(attendee.response_status)}
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>

              {/* Resize handle and inline compose form */}
              <Show when={props.inlineCompose}>
                <div
                  class="inline-resize-handle"
                  onMouseDown={props.inlineCompose!.onResizeStart}
                />
                <div class="inline-compose">
                  <ComposeForm
                    mode={props.inlineCompose!.isForward ? 'forward' : 'reply'}
                    to={props.inlineCompose!.to}
                    setTo={props.inlineCompose!.setTo}
                    cc={props.inlineCompose!.cc}
                    setCc={props.inlineCompose!.setCc}
                    bcc={props.inlineCompose!.bcc}
                    setBcc={props.inlineCompose!.setBcc}
                    showCcBcc={props.inlineCompose!.showCcBcc}
                    setShowCcBcc={props.inlineCompose!.setShowCcBcc}
                    body={props.inlineCompose!.body}
                    setBody={props.inlineCompose!.setBody}
                    attachments={props.inlineCompose!.attachments}
                    onRemoveAttachment={props.inlineCompose!.onRemoveAttachment}
                    onFileSelect={props.inlineCompose!.onFileSelect}
                    fileInputId={`inline-file-input-event-${props.event!.id}`}
                    error={props.inlineCompose!.error}
                    draftSaving={props.inlineCompose!.draftSaving}
                    draftSaved={props.inlineCompose!.draftSaved}
                    sending={props.inlineCompose!.sending}
                    onSend={props.inlineCompose!.onSend}
                    onClose={props.inlineCompose!.onClose}
                    onInput={props.inlineCompose!.onInput}
                    focusBody={props.inlineCompose!.focusBody}
                  />
                </div>
              </Show>

              {/* Inline edit form */}
              <Show when={props.inlineEdit}>
                <div
                  class="inline-resize-handle"
                  onMouseDown={props.inlineEdit!.onResizeStart}
                />
                <div class="inline-compose">
                  <CreateEventForm
                    inline={true}
                    isEditing={true}
                    onClose={props.inlineEdit!.onClose}
                    summary={props.inlineEdit!.summary}
                    setSummary={props.inlineEdit!.setSummary}
                    description={props.inlineEdit!.description}
                    setDescription={props.inlineEdit!.setDescription}
                    location={props.inlineEdit!.location}
                    setLocation={props.inlineEdit!.setLocation}
                    startDate={props.inlineEdit!.startDate}
                    setStartDate={props.inlineEdit!.setStartDate}
                    startTime={props.inlineEdit!.startTime}
                    setStartTime={props.inlineEdit!.setStartTime}
                    endDate={props.inlineEdit!.endDate}
                    setEndDate={props.inlineEdit!.setEndDate}
                    endTime={props.inlineEdit!.endTime}
                    setEndTime={props.inlineEdit!.setEndTime}
                    allDay={props.inlineEdit!.allDay}
                    setAllDay={props.inlineEdit!.setAllDay}
                    attendees={props.inlineEdit!.attendees}
                    setAttendees={props.inlineEdit!.setAttendees}
                    recurrence={props.inlineEdit!.recurrence}
                    setRecurrence={props.inlineEdit!.setRecurrence}
                    saving={props.inlineEdit!.saving}
                    onSave={props.inlineEdit!.onSave}
                    error={props.inlineEdit!.error}
                  />
                </div>
              </Show>
              </div>
          </div>
        </Show>
      </div>

      {/* Calendar Drawer */}
      <Show when={props.calendarDrawerOpen}>
        <div class="label-drawer-overlay" onClick={props.onCloseCalendarDrawer}></div>
        <div class="label-drawer">
          <div class="label-drawer-header">
            <h3>Move to Calendar</h3>
            <CloseButton onClick={props.onCloseCalendarDrawer} />
          </div>

          <div class="label-drawer-body">
            <Show when={props.calendarsLoading}>
              <div class="label-drawer-loading">Loading calendars...</div>
            </Show>

            <Show when={!props.calendarsLoading}>
              <For each={props.calendars}>
                {(cal) => {
                  const isCurrent = () => props.event?.calendar_id === cal.id;

                  return (
                    <label class={`label-item ${isCurrent() ? 'label-item-selected' : ''}`}>
                      <input
                        type="radio"
                        name="event-calendar"
                        checked={isCurrent()}
                        onChange={() => props.onMoveToCalendar(cal.id)}
                      />
                      <span class="label-name">{cal.name}</span>
                      <Show when={cal.is_primary}>
                        <span class="label-badge">Primary</span>
                      </Show>
                    </label>
                  );
                }}
              </For>

              <Show when={!props.calendarsLoading && props.calendars.length === 0}>
                <div class="label-drawer-empty">No calendars found</div>
              </Show>
            </Show>
          </div>

          <div class="label-drawer-footer">
            <span class="shortcut-hint">Press C to toggle calendars</span>
          </div>
        </div>
      </Show>
    </div>
  );
};
