import { createSignal, onCleanup, onMount, Show, For } from "solid-js";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";
import { CloseButton } from "./ComposeAtoms";
import { isImeComposing, isTypingTarget, onActivateKey } from "../shared/keyboard";
import { isWritableCalendar } from "../app/eventActions";

// One labelled, scrollable single-choice list of the scheduler
function SchedulerColumn<T>(props: {
  label: string;
  listClass?: string;
  options: { label: string; value: T }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div class="scheduler-column">
      <label class="scheduler-column-label">{props.label}</label>
      <div class={`scheduler-list ${props.listClass ?? ''}`} role="listbox" aria-label={props.label}>
        <For each={props.options}>
          {(opt) => (
            <div
              class={`scheduler-option ${props.selected === opt.value ? 'selected' : ''}`}
              data-selected={props.selected === opt.value}
              role="option"
              aria-selected={props.selected === opt.value}
              tabIndex={0}
              onClick={() => props.onSelect(opt.value)}
              on:keydown={onActivateKey(() => props.onSelect(opt.value))}
            >
              {opt.label}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

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
  onSave: () => void;
  error: string | null;
  inline?: boolean;
  isEditing?: boolean;
  occurrenceOnly?: boolean;
  // The calendar a new event goes to; an edited event moves with Move instead
  calendars?: { id: string; name: string; is_primary: boolean; access_role: string }[];
  calendarId?: string | null;
  setCalendarId?: (id: string) => void;
}) => {
  // Snapshot is safe: both call sites mount this inside a <Show>, so a fresh
  // instance is created each time the form opens.
  // "T00:00" forces local-time parsing; bare "YYYY-MM-DD" parses as UTC
  // midnight, which is the previous day west of UTC
  const [viewDate, setViewDate] = createSignal(new Date(props.startDate + "T00:00"));

  const getDaysInWindow = () => {
    const days = [];
    const start = new Date(viewDate());
    for (let i = 0; i < 7; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      days.push(day);
    }
    return days;
  };

  const shiftViewDate = (days: number) => {
    const newDate = new Date(viewDate());
    newDate.setDate(newDate.getDate() + days);
    setViewDate(newDate);
  }

  // Recurrence options
  const recurrenceOptions = [
    { label: "No repeat", value: null },
    { label: "Daily", value: "FREQ=DAILY" },
    { label: "Weekly", value: "FREQ=WEEKLY" },
    { label: "Monthly", value: "FREQ=MONTHLY" },
    { label: "Yearly", value: "FREQ=YEARLY" },
    { label: "Weekdays", value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" }
  ];


  // Auto-scroll to selected times when form opens
  onMount(() => {
    // Wait for DOM to be ready
    const scrollTimer = setTimeout(() => {
      const startContainer = document.querySelector('.time-picker-start') as HTMLDivElement;
      const endContainer = document.querySelector('.time-picker-end') as HTMLDivElement;

      if (startContainer) {
        const selectedEl = startContainer.querySelector('[data-selected="true"]') as HTMLElement;
        if (selectedEl) {
          selectedEl.scrollIntoView({ block: 'center' });
        }
      }

      if (endContainer) {
        const selectedEl = endContainer.querySelector('[data-selected="true"]') as HTMLElement;
        if (selectedEl) {
          selectedEl.scrollIntoView({ block: 'center' });
        }
      }
    }, 150);
    onCleanup(() => clearTimeout(scrollTimer));
  });

  // The save button advertises ⌘Enter; handle it on the form so it also
  // works in the inline edit form, which the app-level shortcut (gated on
  // creatingEvent) never reaches. Double-saves in panel mode are prevented
  // by the saving flag, set synchronously by onSave.
  const hasTitle = () => props.summary.trim().length > 0;
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
      props.onSave();
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

  // Move to the 1st before changing month/year: from the 31st (or Feb 29),
  // setMonth/setFullYear would overflow into the following month
  const handleMonthSelect = (month: number) => {
    const newDate = new Date(viewDate());
    newDate.setDate(1);
    newDate.setMonth(month);
    setViewDate(newDate);
  };

  const handleYearSelect = (year: number) => {
    const newDate = new Date(viewDate());
    newDate.setDate(1);
    newDate.setFullYear(year);
    setViewDate(newDate);
  };

  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const currentYear = new Date().getFullYear();
  // Next five years, widened to include the viewed year (e.g. editing a past event)
  const years = () => {
    const viewYear = viewDate().getFullYear();
    const first = Math.min(currentYear, viewYear);
    const last = Math.max(currentYear + 4, viewYear);
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  };

  // Time Helpers
  const timeSlots: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = h.toString().padStart(2, '0');
      const mm = m.toString().padStart(2, '0');
      timeSlots.push(`${hh}:${mm}`);
    }
  }

  const timeToMinutes = (t: string): number | null => {
    const [h, m] = t.split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  };

  const minutesToTime = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

  // Events created elsewhere can have times off the 30-minute grid; insert
  // the current value as an extra slot so it stays visible and selected
  const slotsWithValue = (value: string) => {
    const mins = timeToMinutes(value);
    if (mins === null || timeSlots.includes(value)) return timeSlots;
    const idx = timeSlots.findIndex(t => (timeToMinutes(t) ?? 0) > mins);
    const slots = [...timeSlots];
    slots.splice(idx === -1 ? slots.length : idx, 0, value);
    return slots;
  };

  // Stable option objects so <For> keeps the rendered rows when a time changes
  const timeOptions = new Map<string, { label: string; value: string }>();
  const toOptions = (slots: string[]) => slots.map(t => {
    if (!timeOptions.has(t)) timeOptions.set(t, { label: t, value: t });
    return timeOptions.get(t)!;
  });
  const startOptions = () => toOptions(slotsWithValue(props.startTime));
  const endOptions = () => toOptions(slotsWithValue(props.endTime));

  const formatDateStr = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const isSelectedDate = (d: Date) => formatDateStr(d) === props.startDate;

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

  const formatDateDisplay = (d: Date) => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
      day: days[d.getDay()],
      date: d.getDate()
    };
  };

  const writableCalendars = () => (props.calendars ?? []).filter(isWritableCalendar);

  const formContent = () => (
    <>
      <div class="event-form-header">
        <input
          type="text"
          class="event-title-input"
          value={props.summary}
          onInput={(e) => props.setSummary(e.currentTarget.value)}
          placeholder="Event title"
          aria-label="Event title"
          ref={(el) => setTimeout(() => el.focus(), 0)}
        />
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
        <Show when={!props.inline}>
          <CloseButton onClick={props.onClose} />
        </Show>
      </div>
      <div class={props.inline ? "inline-event-body" : "compose-body"} style={{ flex: 1, "overflow-y": "auto" }}>

        {/* Custom Scheduler UI */}
        <div class="scheduler-ui">

          {/* Month Header */}
          <div class="scheduler-header">
            <div class="scheduler-header-group">
              <select
                value={viewDate().getMonth()}
                onChange={(e) => handleMonthSelect(parseInt(e.currentTarget.value))}
              >
                <For each={months}>
                  {(m, i) => <option value={i()}>{m}</option>}
                </For>
              </select>
              <select
                value={viewDate().getFullYear()}
                onChange={(e) => handleYearSelect(parseInt(e.currentTarget.value))}
              >
                <For each={years()}>
                  {(y) => <option value={y}>{y}</option>}
                </For>
              </select>
            </div>
            <div class="scheduler-header-group">
              <button class="btn btn-sm btn-ghost" onClick={() => shiftViewDate(-7)} title="Previous Week"><ChevronLeftIcon /></button>
              <button class="btn btn-sm btn-ghost" onClick={() => shiftViewDate(7)} title="Next Week"><ChevronRightIcon /></button>
            </div>
          </div>

          {/* Horizontal Days */}
          <div class="scheduler-days">
            <For each={getDaysInWindow()}>
              {(day) => {
                const info = formatDateDisplay(day);
                return (
                  <div
                    class={`scheduler-day-card ${isSelectedDate(day) ? 'selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelectedDate(day)}
                    onClick={() => handleDateSelect(day)}
                    on:keydown={onActivateKey(() => handleDateSelect(day))}
                  >
                    <span class="scheduler-day-name">{info.day}</span>
                    <span class="scheduler-day-number">{info.date}</span>
                  </div>
                );
              }}
            </For>
          </div>

          {/* All day toggle */}
          <label class="scheduler-all-day">
            <input type="checkbox" checked={props.allDay} onChange={(e) => props.setAllDay(e.currentTarget.checked)} />
            All day
          </label>

          {/* Vertical Time Lists + Repeat; all-day events only repeat */}
          <div class="scheduler-times">
            <Show when={!props.allDay}>
              <SchedulerColumn
                label="Start"
                listClass="time-picker-start"
                options={startOptions()}
                selected={props.startTime}
                onSelect={handleStartTimeChange}
              />
              <SchedulerColumn
                label="End"
                listClass="time-picker-end"
                options={endOptions()}
                selected={props.endTime}
                onSelect={handleEndTimeChange}
              />
            </Show>
            <Show
              when={!props.occurrenceOnly}
              fallback={
                <div class="scheduler-column">
                  <label class="scheduler-column-label">Repeat</label>
                  <p class="scheduler-occurrence-note">Repeats (editing this occurrence only)</p>
                </div>
              }
            >
              <SchedulerColumn
                label="Repeat"
                options={recurrenceOptions}
                selected={props.recurrence}
                onSelect={props.setRecurrence}
              />
            </Show>
          </div>
        </div>

        <div class="compose-field">
          <input
            type="text"
            value={props.location}
            onInput={(e) => props.setLocation(e.currentTarget.value)}
            placeholder="Location"
          />
        </div>
        <div class="compose-field">
          <input
            type="text"
            value={props.attendees}
            onInput={(e) => props.setAttendees(e.currentTarget.value)}
            placeholder="Guests (comma separated emails)"
          />
        </div>
        <div class="compose-content">
          <textarea
            value={props.description}
            onInput={(e) => props.setDescription(e.currentTarget.value)}
            placeholder="Description"
            style={{ "min-height": "100px" }}
          />
        </div>
      </div>
      <div class={`event-form-footer ${props.inline ? "inline-event-footer" : "compose-footer"}`}>
        <Show when={props.error}><div class="compose-error">{props.error}</div></Show>
        <div class="compose-spacer" />
        <button class="btn" onClick={props.onClose} style={{ "margin-right": "8px" }}>
          Cancel
        </button>
        <button class="btn btn-primary" disabled={props.saving || !hasTitle()} onClick={props.onSave} title="Save event (⌘Enter)">
          {props.saving ? "Saving..." : <>{props.isEditing ? "Update" : "Save"} <span class="shortcut-hint">⌘↵</span></>}
        </button>
      </div>
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
      style={{ height: "auto", display: "flex", "flex-direction": "column" }}
    >
      {formContent()}
    </div>
  );
};
