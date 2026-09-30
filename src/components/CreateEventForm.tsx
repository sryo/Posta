import { createSignal, createUniqueId, Show, For } from "solid-js";
import { IconButton } from "./IconButton";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";
import { isImeComposing, isTypingTarget } from "../shared/keyboard";
import { relativeDayName } from "../app/dateFormat";
import { clashesWith } from "../app/dayStrip";
import { formatDuration, type DayBusy, type MinuteSpan } from "../app/dayTimeline";
import { DayTimeline } from "./DayTimeline";
import { isWritableCalendar } from "../app/eventActions";
import { minutesToTime, timeToMinutes } from "../app/timeInput";
import { TimeCombobox } from "./TimeCombobox";
import { GuestChips } from "./GuestChips";
import { ScopeMenu, type RecurrenceScope } from "./ScopeMenu";
import { CancelButton, FieldRow, FormFooter, PanelAccount, PanelHeader, SubmitButton, TitleField } from "./FormParts";

const LAST_MINUTE = 23 * 60 + 59;

export const CreateEventForm = (props: {
  closing?: boolean;
  onClose: () => void;
  summary: string;
  setSummary: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  startDate: string;
  setStartDate: (v: string) => void;
  startTime: string;
  setStartTime: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;
  endTime: string;
  setEndTime: (v: string) => void;
  allDay: boolean;
  setAllDay: (v: boolean) => void;
  attendees: string;
  setAttendees: (v: string) => void;
  recurrence: string | null;
  setRecurrence: (v: string | null) => void;
  saving: boolean;
  // A repeating event's occurrence passes the scope the user chose
  onSave: (scope?: RecurrenceScope) => void;
  error: string | null;
  inline?: boolean;
  isEditing?: boolean;
  occurrenceOnly?: boolean;
  // Saving an occurrence of a repeating event asks which events to change
  askScope?: boolean;
  // The calendar a new event goes to; an edited event moves with Move instead
  calendars?: { id: string; name: string; is_primary: boolean; access_role: string }[];
  calendarId?: string | null;
  setCalendarId?: (id: string) => void;
  guestSuggestions?: (query: string) => { email: string; name?: string }[];
  addMeet?: boolean;
  setAddMeet?: (v: boolean) => void;
  // The event being edited already has a Meet link
  hasMeet?: boolean;
  // The account the event is saved to, shown with the calendar
  accountEmail?: string;
  // The user's other events on the chosen day, for the timeline
  dayBusy?: DayBusy;
  now?: number;
}) => {
  // Recurrence options
  const recurrenceOptions = [
    { label: "No repeat", value: null },
    { label: "Daily", value: "FREQ=DAILY" },
    { label: "Weekly", value: "FREQ=WEEKLY" },
    { label: "Monthly", value: "FREQ=MONTHLY" },
    { label: "Yearly", value: "FREQ=YEARLY" },
    { label: "Weekdays", value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" }
  ];

  const fieldId = createUniqueId();

  // The save button advertises ⌘Enter; handle it on the form so it also
  // works in the inline edit form, which the app-level shortcut (gated on
  // creatingEvent) never reaches. Double-saves in panel mode are prevented
  // by the saving flag, set synchronously by onSave.
  const hasTitle = () => props.summary.trim().length > 0;
  const [choosingScope, setChoosingScope] = createSignal(false);
  const save = () => {
    if (props.askScope) setChoosingScope(true);
    else props.onSave();
  };
  const handleKeyDown = (e: KeyboardEvent) => {
    // The title field has focus from the start, and the app-level Escape
    // skips text fields; elsewhere the hosting view's Escape closes the form.
    // A select's Escape belongs to its open list.
    if (e.key === 'Escape' && isTypingTarget(e.target) && !(e.target instanceof HTMLSelectElement) && !isImeComposing(e)) {
      props.onClose();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !props.saving && hasTitle()) {
      e.preventDefault();
      save();
    }
  };

  // Times only constrain each other when start and end fall on the same day
  const isMultiDay = () => props.endDate > props.startDate;

  // Validate end time isn't before start time
  const handleStartTimeChange = (time: string) => {
    const oldStart = timeToMinutes(props.startTime);
    const oldEnd = timeToMinutes(props.endTime);
    props.setStartTime(time);
    const start = timeToMinutes(time);
    if (isMultiDay() || start === null || oldEnd === null) return;
    // If end time is now at or before start time, shift it to keep the duration
    if (oldEnd <= start) {
      const duration = oldStart !== null && oldEnd > oldStart ? oldEnd - oldStart : 30;
      props.setEndTime(minutesToTime(Math.min(start + duration, 23 * 60 + 59)));
    }
  };

  const handleEndTimeChange = (time: string) => {
    const start = timeToMinutes(props.startTime);
    const end = timeToMinutes(time);
    // Only allow if end is after start
    if (isMultiDay() || start === null || (end !== null && end > start)) {
      props.setEndTime(time);
    }
  };

  const formatDateStr = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const handleDateSelect = (d: Date) => {
    const dateStr = formatDateStr(d);
    if (props.isEditing) {
      // Preserve the start→end day span so shifting a multi-day event's
      // start doesn't silently collapse it to a single day
      const oldStart = new Date(props.startDate + "T00:00");
      const oldEnd = new Date(props.endDate + "T00:00");
      const spanDays = Math.max(0, Math.round((oldEnd.getTime() - oldStart.getTime()) / 86400000));
      const newEnd = new Date(d);
      newEnd.setDate(newEnd.getDate() + spanDays);
      props.setStartDate(dateStr);
      props.setEndDate(formatDateStr(newEnd));
    } else {
      props.setStartDate(dateStr);
      props.setEndDate(dateStr); // Default to single day event
    }
  };

  const day = () => new Date(props.startDate + "T00:00");
  const shiftDay = (days: number) => {
    const next = day();
    next.setDate(next.getDate() + days);
    handleDateSelect(next);
  };
  const goToday = () => handleDateSelect(new Date());
  const isToday = () => props.startDate === formatDateStr(new Date());

  // The timeline shows a timed event within one day
  const slot = (): MinuteSpan | null => {
    const start = timeToMinutes(props.startTime);
    const end = timeToMinutes(props.endTime);
    if (props.allDay || isMultiDay() || start === null || end === null || end <= start) return null;
    return { start, end: end === LAST_MINUTE ? 24 * 60 : end };
  };
  const setSlot = (next: MinuteSpan) => {
    props.setStartTime(minutesToTime(next.start));
    props.setEndTime(minutesToTime(Math.min(next.end, LAST_MINUTE)));
  };
  const busy = () => (Array.isArray(props.dayBusy) ? props.dayBusy : undefined);
  const clashes = () => {
    const span = slot();
    const events = busy();
    if (!span || !events) return [];
    const at = (minutes: number) => day().getTime() + minutes * 60_000;
    return clashesWith({ start: at(span.start), end: at(span.end) }, events);
  };
  const calendarNote = () => {
    if (!slot()) return null;
    if (props.dayBusy === "loading") return "Checking calendar…";
    if (props.dayBusy === "unavailable") return "Your calendar isn't shown this far ahead";
    const titles = clashes().map(e => e.title || "an event");
    return titles.length ? `Clashes with ${titles.join(", ")}` : null;
  };

  const writableCalendars = () => (props.calendars ?? []).filter(isWritableCalendar);
  // A primary calendar is named after its address; the header then says it once
  const chosenCalendarName = () => {
    const shown = !props.isEditing && props.setCalendarId && writableCalendars().length > 0;
    return shown ? writableCalendars().find(c => c.id === props.calendarId)?.name : undefined;
  };

  const calendarSelect = () => (
    <Show when={!props.isEditing && props.setCalendarId && writableCalendars().length > 0}>
      <select
        class="event-calendar-select"
        aria-label="Calendar"
        value={props.calendarId ?? ""}
        onChange={(e) => props.setCalendarId!(e.currentTarget.value)}
      >
        <For each={writableCalendars()}>
          {(cal) => <option value={cal.id} selected={cal.id === props.calendarId}>{cal.name}</option>}
        </For>
      </select>
    </Show>
  );

  const formContent = () => (
    <>
      <Show when={!props.inline}>
        <PanelHeader onClose={props.onClose}>
          <Show when={props.accountEmail} fallback={<div class="panel-account">{calendarSelect()}</div>}>
            <PanelAccount email={props.accountEmail!}>
              {calendarSelect()}
              <Show when={chosenCalendarName() !== props.accountEmail}>
                <span class="panel-account-email">{props.accountEmail}</span>
              </Show>
            </PanelAccount>
          </Show>
        </PanelHeader>
      </Show>
      <div class={props.inline ? "inline-event-body" : "compose-body"}>
        <TitleField value={props.summary} onInput={props.setSummary} placeholder="Event title" autofocus />

        <div class="event-when">
          <div class="event-day-line">
            <IconButton label="Previous day" title="Previous day (⌥←)" size="sm" onClick={() => shiftDay(-1)}><ChevronLeftIcon /></IconButton>
            <input
              type="date"
              class="event-day-input"
              aria-label="Day"
              value={props.startDate}
              onChange={(e) => { if (e.currentTarget.value) handleDateSelect(new Date(e.currentTarget.value + "T00:00")); }}
            />
            <IconButton label="Next day" title="Next day (⌥→)" size="sm" onClick={() => shiftDay(1)}><ChevronRightIcon /></IconButton>
            <Show when={relativeDayName(day(), new Date())}>
              {(name) => <span class="event-day-relative">{name()}</span>}
            </Show>
            <Show when={!isToday()}>
              <button type="button" class="event-chip" onClick={goToday}>Today</button>
            </Show>
          </div>

          <Show when={slot()}>
            {(span) => (
              <DayTimeline
                day={day()}
                slot={span()}
                onChange={setSlot}
                busy={busy()}
                clashing={clashes()}
                now={props.now ?? Date.now()}
                onDayShift={shiftDay}
                onToday={goToday}
              />
            )}
          </Show>

          <div class="event-when-summary">
            <Show when={!props.allDay}>
              <TimeCombobox
                label="Start"
                class="time-picker-start"
                value={props.startTime}
                onChange={handleStartTimeChange}
              />
              <span class="scheduler-time-separator" aria-hidden="true">–</span>
              <TimeCombobox
                label="End"
                class="time-picker-end"
                value={props.endTime}
                onChange={handleEndTimeChange}
              />
              <Show when={slot()}>
                {(span) => <span class="event-when-length">{formatDuration(span().end - span().start)}</span>}
              </Show>
            </Show>
            <span class="event-when-note" classList={{ "clash": clashes().length > 0 }} aria-live="polite">{calendarNote()}</span>
          </div>

          <div class="event-when-options">
            <label class="event-chip">
              <input type="checkbox" checked={props.allDay} onChange={(e) => props.setAllDay(e.currentTarget.checked)} />
              All day
            </label>
            <Show
              when={!props.occurrenceOnly}
              fallback={<p class="scheduler-occurrence-note">Repeats</p>}
            >
              <select
                class="event-chip"
                aria-label="Repeat"
                value={props.recurrence ?? ""}
                onChange={(e) => props.setRecurrence(e.currentTarget.value || null)}
              >
                <For each={recurrenceOptions}>
                  {(opt) => <option value={opt.value ?? ""} selected={opt.value === props.recurrence}>{opt.label}</option>}
                </For>
              </select>
            </Show>
          </div>
        </div>

        <FieldRow label="Location" for={`${fieldId}-location`}>
          <input
            id={`${fieldId}-location`}
            type="text"
            value={props.location}
            onInput={(e) => props.setLocation(e.currentTarget.value)}
            placeholder="Add a place"
          />
        </FieldRow>
        <Show when={props.setAddMeet}>
          <FieldRow label="Video" class="event-meet-field">
            <Show when={!props.hasMeet} fallback={<span>Has a Google Meet link</span>}>
              <label class="event-meet-toggle">
                <input type="checkbox" checked={!!props.addMeet} onChange={(e) => props.setAddMeet!(e.currentTarget.checked)} />
                Add Google Meet
              </label>
            </Show>
          </FieldRow>
        </Show>
        <FieldRow label="Guests" for={`${fieldId}-guests`}>
          <GuestChips id={`${fieldId}-guests`} value={props.attendees} onChange={props.setAttendees} suggest={props.guestSuggestions} />
        </FieldRow>
        <div class="compose-content event-description">
          <textarea
            value={props.description}
            onInput={(e) => props.setDescription(e.currentTarget.value)}
            placeholder="Description"
          />
        </div>
      </div>
      <FormFooter class={`event-form-footer ${props.inline ? "inline-event-footer" : "compose-footer"}`} error={props.error}>
        <Show when={props.inline}>
          <CancelButton onClick={props.onClose} />
        </Show>
        <div class="scope-menu-anchor">
          <SubmitButton
            label={props.isEditing ? "Update" : "Save"}
            busy={props.saving}
            busyLabel="Saving..."
            disabled={!hasTitle()}
            onClick={save}
            title="Save event (⌘Enter)"
          />
          <Show when={choosingScope()}>
            <ScopeMenu
              title="Change repeating event"
              onChoose={(scope) => { setChoosingScope(false); props.onSave(scope); }}
              onCancel={() => setChoosingScope(false)}
            />
          </Show>
        </div>
      </FormFooter>
    </>
  );

  if (props.inline) {
    return (
      <div class="inline-event-form" onKeyDown={handleKeyDown}>
        {formContent()}
      </div>
    );
  }

  return (
    <div
      class={`compose-panel event-compose ${props.closing ? 'closing' : ''}`}
      role="dialog"
      aria-label={props.isEditing ? "Edit event" : "New event"}
      onKeyDown={handleKeyDown}
    >
      {formContent()}
    </div>
  );
};
