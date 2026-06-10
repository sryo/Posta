import { createSignal, createEffect, Show, For } from "solid-js";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";
import { CloseButton } from "./ComposeAtoms";

export const CreateEventForm = (props: {
  show: boolean;
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
}) => {
  if (!props.show) return null;

  // Helpers for custom scheduler UI
  const [viewDate, setViewDate] = createSignal(new Date(props.startDate)); // For navigating months

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
  createEffect(() => {
    if (props.show) {
      // Wait for DOM to be ready
      setTimeout(() => {
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
    }
  });

  // Validate end time isn't before start time
  const handleStartTimeChange = (time: string) => {
    props.setStartTime(time);
    // If end time is now before start time, adjust it
    const startIdx = timeSlots.indexOf(time);
    const endIdx = timeSlots.indexOf(props.endTime);
    if (endIdx <= startIdx) {
      // Set end time to 30 mins after start
      const newEndIdx = Math.min(startIdx + 1, timeSlots.length - 1);
      props.setEndTime(timeSlots[newEndIdx]);
    }
  };

  const handleEndTimeChange = (time: string) => {
    const startIdx = timeSlots.indexOf(props.startTime);
    const endIdx = timeSlots.indexOf(time);
    // Only allow if end is after start
    if (endIdx > startIdx) {
      props.setEndTime(time);
    }
  };

  const handleMonthSelect = (month: number) => {
    const newDate = new Date(viewDate());
    newDate.setMonth(month);
    newDate.setDate(1);
    setViewDate(newDate);
  };

  const handleYearSelect = (year: number) => {
    const newDate = new Date(viewDate());
    newDate.setFullYear(year);
    newDate.setDate(1);
    setViewDate(newDate);
  };

  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear + i);

  // Time Helpers
  const timeSlots: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = h.toString().padStart(2, '0');
      const mm = m.toString().padStart(2, '0');
      timeSlots.push(`${hh}:${mm}`);
    }
  }

  const formatDateStr = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const isSelectedDate = (d: Date) => formatDateStr(d) === props.startDate;

  const handleDateSelect = (d: Date) => {
    const dateStr = formatDateStr(d);
    props.setStartDate(dateStr);
    props.setEndDate(dateStr); // Default to single day event
  };

  const formatDateDisplay = (d: Date) => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
      day: days[d.getDay()],
      date: d.getDate()
    };
  };

  const formContent = () => (
    <>
      <div class={props.inline ? "inline-event-body" : "compose-body"} style={{ flex: 1, "overflow-y": "auto" }}>
        <div class="compose-field">
          <input
            type="text"
            value={props.summary}
            onInput={(e) => props.setSummary(e.currentTarget.value)}
            placeholder="Event title"
            autofocus
          />
        </div>

        {/* Custom Scheduler UI */}
        <div class="scheduler-ui" style={{ padding: "10px 0", "border-bottom": "1px solid var(--border)" }}>

          {/* Month Header */}
          <div class="scheduler-header" style={{ display: "flex", "justify-content": "space-between", "align-items": "center", padding: "0 15px 10px" }}>
            <div style={{ display: "flex", gap: "5px", "align-items": "center" }}>
              <select
                value={viewDate().getMonth()}
                onChange={(e) => handleMonthSelect(parseInt(e.currentTarget.value))}
                style={{ "font-weight": "600", "font-size": "14px", background: "transparent", border: "none", color: "var(--text)", cursor: "pointer" }}
              >
                <For each={months}>
                  {(m, i) => <option value={i()}>{m}</option>}
                </For>
              </select>
              <select
                value={viewDate().getFullYear()}
                onChange={(e) => handleYearSelect(parseInt(e.currentTarget.value))}
                style={{ "font-weight": "600", "font-size": "14px", background: "transparent", border: "none", color: "var(--text)", cursor: "pointer" }}
              >
                <For each={years}>
                  {(y) => <option value={y}>{y}</option>}
                </For>
              </select>
            </div>
            <div style={{ display: "flex", gap: "5px" }}>
              <button class="btn btn-sm btn-ghost" onClick={() => shiftViewDate(-7)} title="Previous Week"><ChevronLeftIcon /></button>
              <button class="btn btn-sm btn-ghost" onClick={() => shiftViewDate(7)} title="Next Week"><ChevronRightIcon /></button>
            </div>
          </div>

          {/* Horizontal Days */}
          <div class="scheduler-days" style={{ display: "flex", gap: "10px", "overflow-x": "auto", padding: "0 15px 15px", "scrollbar-width": "none" }}>
            <For each={getDaysInWindow()}>
              {(day) => {
                const info = formatDateDisplay(day);
                const selected = () => isSelectedDate(day);
                return (
                  <div
                    class={`scheduler-day-card ${selected() ? 'selected' : ''}`}
                    onClick={() => handleDateSelect(day)}
                    style={{
                      display: "flex", "flex-direction": "column", "align-items": "center", "justify-content": "center",
                      width: "60px", height: "70px",
                      border: selected() ? "2px solid var(--accent)" : "1px solid var(--border)",
                      "border-radius": "8px",
                      "background-color": selected() ? "var(--accent)" : "var(--card-bg)",
                      cursor: "pointer",
                      "flex-shrink": 0
                    }}
                  >
                    <span style={{ "font-size": "12px", color: selected() ? "#fff" : "var(--text-secondary)" }}>{info.day}</span>
                    <span style={{ "font-size": "20px", "font-weight": "600", color: selected() ? "#fff" : "var(--text)" }}>{info.date}</span>
                  </div>
                );
              }}
            </For>
          </div>


          {/* All day toggle */}
          <div style={{ display: "flex", "justify-content": "flex-start", padding: "0 15px", "margin-bottom": "8px" }}>
            <label style={{ display: "flex", "align-items": "center", gap: "5px", cursor: "pointer", "font-size": "12px", color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={props.allDay} onChange={(e) => props.setAllDay(e.currentTarget.checked)} />
              All day
            </label>
          </div>

          {/* Vertical Time Lists + Repeat */}
          <Show when={!props.allDay}>
            <div class="scheduler-times" style={{ display: "flex", gap: "15px", padding: "0 15px", height: "200px" }}>
              <div style={{ flex: 1, display: "flex", "flex-direction": "column" }}>
                <div style={{ display: "flex", "align-items": "center", height: "17px", "margin-bottom": "5px" }}>
                  <label style={{ "font-size": "12px", color: "var(--text-secondary)" }}>Start</label>
                </div>
                <div class="time-picker-start" style={{ flex: 1, "overflow-y": "auto", border: "1px solid var(--border)", "border-radius": "6px" }}>
                  <For each={timeSlots}>
                    {(t) => (
                      <div
                        onClick={() => handleStartTimeChange(t)}
                        data-selected={props.startTime === t}
                        style={{
                          "padding": "6px 10px",
                          "cursor": "pointer",
                          "background-color": props.startTime === t ? "var(--accent)" : "transparent",
                          "color": props.startTime === t ? "#fff" : "var(--text)",
                          "border-radius": "6px",
                          "font-size": "13px",
                          "text-align": "center"
                        }}
                      >
                        {t}
                      </div>
                    )}
                  </For>
                </div>
              </div>
              <div style={{ flex: 1, display: "flex", "flex-direction": "column" }}>
                <div style={{ display: "flex", "align-items": "center", height: "17px", "margin-bottom": "5px" }}>
                  <label style={{ "font-size": "12px", color: "var(--text-secondary)" }}>End</label>
                </div>
                <div class="time-picker-end" style={{ flex: 1, "overflow-y": "auto", border: "1px solid var(--border)", "border-radius": "6px" }}>
                  <For each={timeSlots}>
                    {(t) => (
                      <div
                        onClick={() => handleEndTimeChange(t)}
                        data-selected={props.endTime === t}
                        style={{
                          "padding": "6px 10px",
                          "cursor": "pointer",
                          "background-color": props.endTime === t ? "var(--accent)" : "transparent",
                          "color": props.endTime === t ? "#fff" : "var(--text)",
                          "border-radius": "6px",
                          "font-size": "13px",
                          "text-align": "center"
                        }}
                      >
                        {t}
                      </div>
                    )}
                  </For>
                </div>
              </div>
              <div style={{ flex: 1, display: "flex", "flex-direction": "column" }}>
                <div style={{ display: "flex", "align-items": "center", height: "17px", "margin-bottom": "5px" }}>
                  <label style={{ "font-size": "12px", color: "var(--text-secondary)" }}>Repeat</label>
                </div>
                <div style={{ flex: 1, "overflow-y": "auto", border: "1px solid var(--border)", "border-radius": "6px" }}>
                  <For each={recurrenceOptions}>
                    {(opt) => (
                      <div
                        onClick={() => props.setRecurrence(opt.value)}
                        style={{
                          "padding": "6px 10px",
                          "cursor": "pointer",
                          "background-color": props.recurrence === opt.value ? "var(--accent)" : "transparent",
                          "color": props.recurrence === opt.value ? "#fff" : "var(--text)",
                          "border-radius": "6px",
                          "font-size": "13px",
                          "text-align": "center"
                        }}
                      >
                        {opt.label}
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </Show>
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
      <div class={props.inline ? "inline-event-footer" : "compose-footer"}>
        <Show when={props.error}><div class="compose-error">{props.error}</div></Show>
        <div class="compose-spacer" />
        <button class="btn btn-secondary" onClick={props.onClose} style={{ "margin-right": "8px" }}>
          Cancel
        </button>
        <button class="btn btn-primary" disabled={props.saving || !props.summary} onClick={props.onSave} title="Save event (⌘Enter)">
          {props.saving ? "Saving..." : <>{props.isEditing ? "Update" : "Save"} <span class="shortcut-hint">⌘↵</span></>}
        </button>
      </div>
    </>
  );

  if (props.inline) {
    return (
      <div class="inline-event-form">
        {formContent()}
      </div>
    );
  }

  return (
    <div class={`compose-panel event-compose ${props.closing ? 'closing' : ''}`} style={{ height: "auto", "max-height": "90vh", display: "flex", "flex-direction": "column" }}>
      <div class="compose-header">
        <h3>{props.isEditing ? "Edit event" : "New event"}</h3>
        <CloseButton onClick={props.onClose} />
      </div>
      {formContent()}
    </div>
  );
};
