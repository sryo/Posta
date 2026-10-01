import { createEffect, createMemo, createSignal, on, onMount, onCleanup, Show, For } from "solid-js";
import { StatusLine } from "./StatusLine";
import { KeyHint } from "./KeyHint";
import DOMPurify from 'dompurify';
import { DOMPURIFY_CONFIG } from './MessageBody';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { GoogleCalendarEvent } from "../api/tauri";
import { formatCalendarEventDate, textOrHtmlToHtml } from "../utils";
import { guestResponseLabel, isRsvpAnswer, ownResponseLabel, rsvpForKey } from "../app/rsvp";
import { RsvpControl } from "./RsvpControl";
import { ScopeMenu, type RecurrenceScope } from "./ScopeMenu";
import { deletePrompt, eventActions, isWritableCalendar } from "../app/eventActions";
import {
  ReplyIcon,
  ReplyAllIcon,
  TrashIcon,
  EditIcon,
  CalendarIcon,
  MoveToCalendarIcon,
  LocationIcon,
  VideoIcon,
  ExternalIcon,
} from "./Icons";
import { CloseButton } from "./ComposeAtoms";
import { ComposeForm } from "./ComposeForm";
import { CreateEventForm } from "./CreateEventForm";
import { MessageActionsWheel } from "./MessageActionsWheel";
import { CardPill } from "./CardPill";
import { organizerName } from "../app/people";
import { createCloseAfterAnimation } from "../shared/closeAfterAnimation";
import { createRowMotion, SHRINK_MS } from "../shared/rowMotion";
import { isTypingTarget, hasCommandModifier } from "../shared/keyboard";
import type { InlineComposeProps, InlineEditEventProps } from "./types";
import { useLayer } from "../app/layers";
import { Sheet } from "./Sheet";
import { useDialog } from "../app/dialog";

// Event View Component
export const EventView = (props: {
  event: GoogleCalendarEvent | null;
  card: { name: string; color: string | null } | null;
  onClose: () => void;
  onRsvp: (status: "accepted" | "declined" | "tentative") => void;
  onReplyOrganizer: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onEdit: () => void;
  // An occurrence of a repeating event passes the scope the user chose
  onDelete: (scope?: RecurrenceScope) => void;
  onOpenCalendars: () => void;
  calendarDrawerOpen: boolean;
  onCloseCalendarDrawer: () => void;
  // Signed-in account's email; decides whether the user owns, hosts or is invited to the event
  accountEmail: string;
  // A name the user's mail gives an address, for an organizer the guest list doesn't name
  nameForEmail?: (email: string) => string | undefined;
  calendars: { id: string; name: string; is_primary: boolean; access_role: string }[];
  calendarsLoading: boolean;
  onMoveToCalendar: (calendarId: string) => void;
  rsvpLoading: boolean;
  inlineCompose: InlineComposeProps | null;
  inlineEdit: InlineEditEventProps | null;
  // The row the event was opened from, which the view grows out of and
  // shrinks back into
  origin?: () => Element | null;
}) => {

  const motion = createRowMotion(() => props.origin?.());
  const { closing, close } = createCloseAfterAnimation(() => props.onClose(), SHRINK_MS);
  const handleClose = () => {
    if (!closing()) motion.close();
    close();
  };
  const dialogRef = useDialog({ onClose: handleClose, labelledBy: "event-view-title", initialFocus: (el) => el });

  const actions = createMemo(() => props.event ? eventActions(props.event, props.accountEmail) : null);
  const moveTargets = () => props.calendars.filter(isWritableCalendar);

  const [choosingDeleteScope, setChoosingDeleteScope] = createSignal(false);
  const handleDelete = () => {
    if (props.event?.recurring_event_id) setChoosingDeleteScope(true);
    else props.onDelete();
  };
  createEffect(on(() => props.event?.id, () => setChoosingDeleteScope(false), { defer: true }));

  // Shortcuts advertised by the toolbar badges (R/V/O/M/E/#), the RSVP control (Y/⇧M/N)
  // and the actions wheel (R/⇧R/F)
  const handleKeyDown = (e: KeyboardEvent) => {
    // The open drawer holds focus, on its calendar choices, and keeps only the
    // key its footer promises
    if (props.calendarDrawerOpen) {
      if (e.key === 'm' && !hasCommandModifier(e)) { e.preventDefault(); props.onCloseCalendarDrawer(); }
      return;
    }
    if (isTypingTarget(e.target) || hasCommandModifier(e) || !props.event || props.inlineCompose || props.inlineEdit) return;
    const event = props.event;
    const can = actions()!;

    if (e.key === 'r' && can.reply) { e.preventDefault(); props.onReplyOrganizer(); return; }
    if (e.key === 'r' && can.emailGuests) { e.preventDefault(); props.onReplyAll(); return; }
    if (e.key === 'R' && can.reply) { e.preventDefault(); props.onReplyAll(); return; }
    if (e.key === 'f') { e.preventDefault(); props.onForward(); return; }
    if (e.key === 'v' && event.hangout_link) { e.preventDefault(); openUrl(event.hangout_link); return; }
    if (e.key === 'o' && event.html_link) { e.preventDefault(); openUrl(event.html_link); return; }
    if (e.key === 'm' && can.move) {
      e.preventDefault();
      props.onOpenCalendars();
      return;
    }
    const answer = can.rsvp ? rsvpForKey(e) : null;
    if (answer) {
      e.preventDefault();
      if (answer !== event.response_status && !props.rsvpLoading) props.onRsvp(answer);
      return;
    }
    if (e.key === 'e' && can.edit) { e.preventDefault(); props.onEdit(); return; }
    if ((e.key === 'd' || e.key === '#') && can.delete) {
      e.preventDefault();
      // A held key repeats
      if (!e.repeat) handleDelete();
      return;
    }
  };

  onMount(() => document.addEventListener('keydown', handleKeyDown));
  onCleanup(() => document.removeEventListener('keydown', handleKeyDown));

  // Escape closes whichever of these opened last
  useLayer(() => !!props.inlineCompose, () => props.inlineCompose?.onClose());
  useLayer(() => !!props.inlineEdit, () => props.inlineEdit?.onClose());

  return (
    <div ref={(el) => { dialogRef(el); motion.ref(el); }} class={`thread-overlay ${closing() ? 'closing' : ''} ${motion.viaRow() ? 'via-row' : ''}`}>
      <div class="thread-floating-bar">
        {/* Row 1: Close + Title + Card indicator */}
        <div class="thread-floating-bar-row">
          <CloseButton onClick={handleClose} />
          <div class="thread-bar-subject">
            <Show when={props.event} fallback={<span>Loading...</span>}>
              <h2 id="event-view-title">{props.event?.title || '(No title)'}</h2>
            </Show>
          </div>
          <Show when={props.card}>
            <CardPill color={props.card?.color}>{props.card?.name}</CardPill>
          </Show>
        </div>

        {/* Row 2: Actions */}
        <Show when={props.event}>
          <div class="thread-floating-bar-row thread-bar-actions">
            <Show when={actions()!.reply}>
              <button
                class="thread-toolbar-btn"
                onClick={props.onReplyOrganizer}
                title="Reply to organizer"
              >
                <ReplyIcon />
                <span class="thread-toolbar-label">Reply</span>
                <KeyHint keys="R" />
              </button>
            </Show>

            <Show when={actions()!.emailGuests}>
              <button
                class="thread-toolbar-btn"
                onClick={props.onReplyAll}
                title="Email guests"
              >
                <ReplyAllIcon />
                <span class="thread-toolbar-label">Email guests</span>
                <KeyHint keys="R" />
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
                <KeyHint keys="V" />
              </button>
            </Show>

            <Show when={props.event!.html_link}>
              <button
                class="thread-toolbar-btn"
                onClick={() => props.event!.html_link && openUrl(props.event!.html_link)}
                title="Open in Google Calendar"
              >
                <CalendarIcon />
                <span class="thread-toolbar-label">Google Calendar</span><ExternalIcon size="meta" />
                <KeyHint keys="O" />
              </button>
            </Show>

            <Show when={actions()!.move}>
              <button class="thread-toolbar-btn" onClick={props.onOpenCalendars} title="Move to calendar">
                <MoveToCalendarIcon />
                <span class="thread-toolbar-label">Move to…</span>
                <KeyHint keys="M" />
              </button>
            </Show>

            <Show when={actions()!.edit || actions()!.delete}>
              <div class="thread-toolbar-divider" />
            </Show>

            <Show when={actions()!.edit}>
              <button
                class="thread-toolbar-btn"
                onClick={props.onEdit}
                title="Edit event"
              >
                <EditIcon />
                <span class="thread-toolbar-label">Edit</span>
                <KeyHint keys="E" />
              </button>
            </Show>

            <Show when={actions()!.delete}>
              <div class="scope-menu-anchor">
              <button
                class="thread-toolbar-btn thread-toolbar-btn-danger"
                onClick={(e) => { if (e.detail <= 1) handleDelete(); }}
                title="Delete event"
              >
                <TrashIcon />
                <span class="thread-toolbar-label">Delete</span>
                <KeyHint keys="#" />
              </button>
              <Show when={choosingDeleteScope()}>
                <ScopeMenu
                  title={actions()!.role === 'organizer' ? deletePrompt(actions()!) : "Delete repeating event"}
                  onChoose={(scope) => { setChoosingDeleteScope(false); props.onDelete(scope); }}
                  onCancel={() => setChoosingDeleteScope(false)}
                />
              </Show>
              </div>
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
                    <div class="message-sender" title={props.event!.organizer ?? undefined}>{organizerName(props.event!, props.accountEmail, props.nameForEmail) || 'Unknown organizer'}</div>
                    <div class="message-date">{formatCalendarEventDate(props.event!.start_time, props.event!.end_time, props.event!.all_day)}</div>
                  </div>

                  {/* Message Actions Wheel - hide when composing or editing */}
                  <Show when={!props.inlineCompose && !props.inlineEdit}>
                    <MessageActionsWheel
                      onReply={actions()!.reply ? props.onReplyOrganizer : undefined}
                      onReplyAll={actions()!.reply || actions()!.emailGuests ? props.onReplyAll : undefined}
                      replyAllTitle={actions()!.emailGuests ? "Email guests" : undefined}
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
                      <button type="button" class="link-btn" onClick={() => props.event!.hangout_link && openUrl(props.event!.hangout_link)}>
                        Join video call
                      </button>
                    </div>
                  </Show>

                  {/* Description */}
                  <Show when={props.event!.description}>
                    <div class="message-body">
                      <div innerHTML={DOMPurify.sanitize(textOrHtmlToHtml(props.event!.description!), DOMPURIFY_CONFIG)} />
                    </div>
                  </Show>

                  {/* RSVP Section */}
                  <Show when={actions()!.rsvp}>
                    <div class="event-rsvp-section">
                      <div class="event-rsvp-current">
                        {isRsvpAnswer(props.event!.response_status) ? "Your response" : ownResponseLabel(props.event!.response_status)}
                      </div>
                      <RsvpControl
                        value={props.event!.response_status}
                        onAnswer={props.onRsvp}
                        disabled={props.rsvpLoading}
                        showKeys
                      />
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
                                {guestResponseLabel(attendee.response_status)}
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
                    suggestContacts={props.inlineCompose!.suggestContacts}
                    fromEmail={props.inlineCompose!.fromEmail}
                    body={props.inlineCompose!.body}
                    setBody={props.inlineCompose!.setBody}
                    attachments={props.inlineCompose!.attachments}
                    onRemoveAttachment={props.inlineCompose!.onRemoveAttachment}
                    onFileSelect={props.inlineCompose!.onFileSelect}
                    onAddFiles={props.inlineCompose!.onAddFiles}
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
                    occurrenceOnly={props.inlineEdit!.occurrenceOnly}
                    askScope={props.inlineEdit!.askScope}
                    guestSuggestions={props.inlineEdit!.guestSuggestions}
                    addMeet={props.inlineEdit!.addMeet}
                    setAddMeet={props.inlineEdit!.setAddMeet}
                    hasMeet={props.inlineEdit!.hasMeet}
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
        <Sheet title="Move to Calendar" placement="side" class="label-drawer" onClose={props.onCloseCalendarDrawer}>
          <div class="label-drawer-body">
            <Show when={props.calendarsLoading}>
              <StatusLine kind="loading">Loading calendars...</StatusLine>
            </Show>

            <Show when={!props.calendarsLoading}>
              <For each={moveTargets()}>
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

              <Show when={!props.calendarsLoading && moveTargets().length === 0}>
                <StatusLine kind="empty">No calendars found</StatusLine>
              </Show>
            </Show>
          </div>

          <div class="label-drawer-footer">
            <KeyHint keys="M to close" />
          </div>
        </Sheet>
      </Show>
    </div>
  );
};
