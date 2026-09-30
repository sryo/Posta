import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { CreateEventForm } from "./CreateEventForm";

function renderForm(init: { startDate: string; endDate?: string; startTime?: string; endTime?: string; isEditing?: boolean; allDay?: boolean; setRecurrence?: (v: string | null) => void; summary?: string; onSave?: () => void; onClose?: () => void; extra?: Partial<Parameters<typeof CreateEventForm>[0]> }) {
  const [startDate, setStartDate] = createSignal(init.startDate);
  const [endDate, setEndDate] = createSignal(init.endDate ?? init.startDate);
  const [startTime, setStartTime] = createSignal(init.startTime ?? "10:00");
  const [endTime, setEndTime] = createSignal(init.endTime ?? "11:00");
  const result = render(() => (
    <CreateEventForm
      onClose={init.onClose ?? vi.fn()}
      summary={init.summary ?? "Trip"}
      setSummary={vi.fn()}
      description=""
      setDescription={vi.fn()}
      location=""
      setLocation={vi.fn()}
      startDate={startDate()}
      setStartDate={setStartDate}
      startTime={startTime()}
      setStartTime={setStartTime}
      endDate={endDate()}
      setEndDate={setEndDate}
      endTime={endTime()}
      setEndTime={setEndTime}
      allDay={init.allDay ?? false}
      setAllDay={vi.fn()}
      attendees=""
      setAttendees={vi.fn()}
      recurrence={null}
      setRecurrence={init.setRecurrence ?? vi.fn()}
      saving={false}
      onSave={init.onSave ?? vi.fn()}
      error={null}
      isEditing={init.isEditing}
      {...(init.extra ?? {})}
    />
  ));
  return { ...result, startDate, endDate, startTime, endTime };
}

const slider = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="slider"]')!;

const timeField = (container: HTMLElement, label: "Start" | "End") =>
  container.querySelector<HTMLInputElement>(`input[role="combobox"][aria-label="${label}"]`)!;

// Types a time into the Start or End field and confirms it
const typeTime = (container: HTMLElement, label: "Start" | "End", text: string) => {
  const input = timeField(container, label);
  fireEvent.input(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
};

// jsdom has no layout; the form scrolls the selected times into view on open
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("CreateEventForm closing", () => {
  it("closes on Escape from the title, like the compose form", () => {
    const onClose = vi.fn();
    const { container } = renderForm({ startDate: "2025-03-10", onClose });
    fireEvent.keyDown(container.querySelector<HTMLInputElement>('input[placeholder="Event title"]')!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the Escape that cancels an input method composition", () => {
    const onClose = vi.fn();
    const { container } = renderForm({ startDate: "2025-03-10", onClose });
    fireEvent.keyDown(container.querySelector("textarea")!, { key: "Escape", isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  // Outside text fields the view hosting the form owns Escape
  it("leaves Escape on the focused timeline to the hosting view", () => {
    const onClose = vi.fn();
    const { container } = renderForm({ startDate: "2025-03-10", onClose });
    fireEvent.keyDown(slider(container), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves Escape in the repeat menu to the menu", () => {
    const onClose = vi.fn();
    const { getByRole } = renderForm({ startDate: "2025-03-10", onClose });
    fireEvent.keyDown(getByRole("combobox", { name: "Repeat" }), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("CreateEventForm saving", () => {
  it("won't save an event whose title is only spaces", () => {
    const onSave = vi.fn();
    const { container } = renderForm({ startDate: "2025-03-10", summary: "   ", onSave });
    const save = container.querySelector<HTMLButtonElement>(".btn-primary")!;
    expect(save.disabled).toBe(true);
    fireEvent.keyDown(container.querySelector("textarea")!, { key: "Enter", metaKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves on ⌘Enter once there is a title", () => {
    const onSave = vi.fn();
    const { container } = renderForm({ startDate: "2025-03-10", summary: "Trip", onSave });
    fireEvent.keyDown(container.querySelector("textarea")!, { key: "Enter", metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("CreateEventForm closing", () => {
  it("doesn't touch the page after it closes", () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderForm({ startDate: "2025-03-10" });
      unmount();
      const query = vi.spyOn(document, "querySelector");
      vi.runAllTimers();
      expect(query).not.toHaveBeenCalled();
      query.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CreateEventForm focus", () => {
  it("focuses the title when opened", async () => {
    const { container } = renderForm({ startDate: "2031-03-03" });
    await new Promise(r => setTimeout(r, 100));
    expect(document.activeElement).toBe(container.querySelector('input[placeholder="Event title"]'));
  });
});

describe("CreateEventForm day", () => {
  it("steps a day at a time, and picks one from the date field", () => {
    const { getByRole, getByLabelText, startDate, endDate } = renderForm({ startDate: "2031-01-31" });
    fireEvent.click(getByRole("button", { name: "Next day" }));
    expect(startDate()).toBe("2031-02-01");
    expect(endDate()).toBe("2031-02-01");
    fireEvent.click(getByRole("button", { name: "Previous day" }));
    fireEvent.click(getByRole("button", { name: "Previous day" }));
    expect(startDate()).toBe("2031-01-30");
    fireEvent.change(getByLabelText("Day"), { target: { value: "2031-06-10" } });
    expect(startDate()).toBe("2031-06-10");
  });

  it("keeps a multi-day event's length when its day moves", () => {
    const { getByRole, startDate, endDate } = renderForm({ startDate: "2031-03-03", endDate: "2031-03-05", isEditing: true });
    fireEvent.click(getByRole("button", { name: "Next day" }));
    expect(startDate()).toBe("2031-03-04");
    expect(endDate()).toBe("2031-03-06");
  });

  it("goes back to today", () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const { getByRole, queryByRole, startDate } = renderForm({ startDate: "2031-03-03" });
    fireEvent.click(getByRole("button", { name: "Today" }));
    expect(startDate()).toBe(iso);
    expect(queryByRole("button", { name: "Today" })).toBeNull();
  });
});

describe("CreateEventForm timeline", () => {
  it("moves the event a step with the arrow keys, and resizes it with Shift", () => {
    const { container, startTime, endTime } = renderForm({ startDate: "2031-03-03", startTime: "10:00", endTime: "11:00" });
    expect(slider(container)).toHaveAttribute("aria-valuetext");
    fireEvent.keyDown(slider(container), { key: "ArrowRight" });
    expect([startTime(), endTime()]).toEqual(["10:15", "11:15"]);
    fireEvent.keyDown(slider(container), { key: "ArrowLeft", shiftKey: true });
    expect([startTime(), endTime()]).toEqual(["10:15", "11:00"]);
  });

  it("changes the day with Option and the arrow keys", () => {
    const { container, startDate } = renderForm({ startDate: "2031-03-03" });
    fireEvent.keyDown(slider(container), { key: "ArrowRight", altKey: true });
    expect(startDate()).toBe("2031-03-04");
  });

  it("types a time too, and saves with Cmd+Enter from the timeline or a time", () => {
    const onSave = vi.fn();
    const { container, startTime } = renderForm({ startDate: "2031-03-03", onSave });
    typeTime(container, "Start", "9am");
    expect(startTime()).toBe("09:00");
    fireEvent.keyDown(slider(container), { key: "Enter", metaKey: true });
    fireEvent.keyDown(timeField(container, "Start"), { key: "Enter", ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("shows the day's other events and says which ones the event clashes with", () => {
    const at = (h: number) => new Date(2031, 2, 3, h).getTime();
    const dayBusy = [{ title: "Standup", start: at(9), end: at(10) }, { title: "Design sync", start: at(10), end: at(12) }];
    const { container } = renderForm({ startDate: "2031-03-03", startTime: "11:00", endTime: "12:30", extra: { dayBusy } });
    expect(Array.from(container.querySelectorAll(".day-timeline-busy")).map(b => [b.textContent, b.classList.contains("overlap")]))
      .toEqual([["Standup", false], ["Design sync", true]]);
    expect(container.querySelector(".event-when-note")).toHaveTextContent("Clashes with Design sync");
  });

  it("says the calendar is still being read instead of showing a free day", () => {
    const { container } = renderForm({ startDate: "2031-03-03", extra: { dayBusy: "loading" } });
    expect(container.querySelector(".event-when-note")).toHaveTextContent("Checking calendar…");
  });

  it("leaves the timeline out of an all-day event", () => {
    const { container } = renderForm({ startDate: "2031-03-03", allDay: true });
    expect(container.querySelector(".day-timeline")).toBeNull();
  });
});

describe("CreateEventForm time pickers", () => {
  it("keeps end after start on a single-day event", () => {
    const { container, endTime } = renderForm({ startDate: "2031-03-03", startTime: "10:00", endTime: "11:00" });
    typeTime(container, "End", "09:00");
    expect(endTime()).toBe("11:00");
  });

  it("moves the end along with the start, keeping the length", () => {
    const { container, endTime } = renderForm({ startDate: "2031-03-03", startTime: "10:00", endTime: "11:00" });
    typeTime(container, "Start", "11:30");
    expect(endTime()).toBe("12:30");
  });

  it("offers times in 15-minute steps", () => {
    const { container } = renderForm({ startDate: "2031-03-03", startTime: "10:00", endTime: "11:00" });
    fireEvent.focus(timeField(container, "Start"));
    expect(container.querySelectorAll(".time-picker-start [role=option]")).toHaveLength(96);
  });

  it("allows an end time earlier in the day than the start on a multi-day event", () => {
    const { container, endTime } = renderForm({
      startDate: "2031-03-03", endDate: "2031-03-05", startTime: "22:00", endTime: "23:00", isEditing: true,
    });
    typeTime(container, "End", "09:00");
    expect(endTime()).toBe("09:00");
  });

  it("does not drag a multi-day event's end time along with its start", () => {
    const { container, endTime } = renderForm({
      startDate: "2031-03-03", endDate: "2031-03-05", startTime: "08:00", endTime: "09:00", isEditing: true,
    });
    typeTime(container, "Start", "10:00");
    expect(endTime()).toBe("09:00");
  });
});


describe("CreateEventForm header", () => {
  const calendars = [
    { id: "me@x.test", name: "me@x.test", is_primary: true, access_role: "owner" },
    { id: "birthdays", name: "Birthdays", is_primary: false, access_role: "reader" },
    { id: "team", name: "Team", is_primary: false, access_role: "writer" },
  ];

  it("names the account and calendar above the title, leaving Cancel to the footer", () => {
    const { container, getByRole } = renderForm({ startDate: "2031-03-03", extra: { calendars, calendarId: "team", setCalendarId: vi.fn(), accountEmail: "me@x.test" } });
    const header = container.querySelector(".panel-header")!;
    expect(header.querySelector(".panel-account-avatar")).toHaveAttribute("data-hue");
    expect(header).toHaveTextContent("me@x.test");
    const select = getByRole("combobox", { name: "Calendar" }) as HTMLSelectElement;
    expect(header.contains(select)).toBe(true);
    expect(select.value).toBe("team");
    // Escape discards the event, so it is Cancel in the footer, not a close up here
    expect(header.querySelector(".close-btn")).toBeNull();
    expect(container.querySelector(".event-form-footer")).toHaveTextContent("Cancel");
    expect(header.querySelector('input[placeholder="Event title"]')).toBeNull();
    expect(container.querySelector('input[placeholder="Event title"]')).toHaveClass("form-title-field");
  });

  it("names the address once when the calendar is named after it", () => {
    const { container } = renderForm({ startDate: "2031-03-03", extra: { calendars, calendarId: "me@x.test", setCalendarId: vi.fn(), accountEmail: "me@x.test" } });
    expect(container.querySelector(".panel-account-email")).toBeNull();
  });

  it("offers only calendars the user can write to", () => {
    const setCalendarId = vi.fn();
    const { getByRole } = renderForm({ startDate: "2031-03-03", extra: { calendars, calendarId: "me@x.test", setCalendarId } });
    const select = getByRole("combobox", { name: "Calendar" }) as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(["me@x.test", "Team"]);
    fireEvent.change(select, { target: { value: "team" } });
    expect(setCalendarId).toHaveBeenCalledWith("team");
  });

  it("leaves the calendar of an event being edited to Move", () => {
    const { queryByRole } = renderForm({ startDate: "2031-03-03", isEditing: true, extra: { calendars, calendarId: "team", setCalendarId: vi.fn() } });
    expect(queryByRole("combobox", { name: "Calendar" })).toBeNull();
  });

  it("keeps Cancel and Save in a footer that stays in view", () => {
    const { container } = renderForm({ startDate: "2031-03-03" });
    expect(container.querySelector(".event-form-footer .btn-primary")).not.toBeNull();
  });
});

describe("CreateEventForm guests", () => {
  it("adds guests as chips from the contact suggestions", () => {
    const setAttendees = vi.fn();
    const guestSuggestions = vi.fn(() => [{ email: "ana@x.test", name: "Ana" }]);
    const { getByRole } = renderForm({ startDate: "2031-03-03", extra: { setAttendees, guestSuggestions } });
    const input = getByRole("combobox", { name: "Guests" });
    fireEvent.input(input, { target: { value: "an" } });
    expect(guestSuggestions).toHaveBeenCalledWith("an");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(setAttendees).toHaveBeenCalledWith('"Ana" <ana@x.test>');
  });
});

describe("CreateEventForm Google Meet", () => {
  it("adds a Meet link with a toggle", () => {
    const setAddMeet = vi.fn();
    const { getByRole } = renderForm({ startDate: "2031-03-03", extra: { addMeet: false, setAddMeet } });
    const toggle = getByRole("checkbox", { name: "Add Google Meet" });
    fireEvent.click(toggle);
    expect(setAddMeet).toHaveBeenCalledWith(true);
  });

  it("says an event already has a Meet link instead of offering another", () => {
    const { queryByRole, getByText } = renderForm({ startDate: "2031-03-03", isEditing: true, extra: { addMeet: false, setAddMeet: vi.fn(), hasMeet: true } });
    expect(queryByRole("checkbox", { name: "Add Google Meet" })).toBeNull();
    expect(getByText("Has a Google Meet link")).toBeInTheDocument();
  });
});

describe("CreateEventForm repeating event", () => {
  it("asks which events to change before saving an occurrence", () => {
    const onSave = vi.fn();
    const { container, getByRole } = renderForm({ startDate: "2031-03-03", isEditing: true, onSave, extra: { askScope: true } });
    fireEvent.click(container.querySelector<HTMLButtonElement>(".event-form-footer .btn-primary")!);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(getByRole("menuitem", { name: "All events" }));
    expect(onSave).toHaveBeenCalledWith("all");
  });

  it("asks on ⌘Enter too, and Escape goes back to the form", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const { container, getByRole, queryByRole } = renderForm({ startDate: "2031-03-03", isEditing: true, onSave, onClose, extra: { askScope: true } });
    fireEvent.keyDown(container.querySelector("textarea")!, { key: "Enter", metaKey: true });
    const menu = getByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(queryByRole("menu")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves a one-off event straight away", () => {
    const onSave = vi.fn();
    const { container } = renderForm({ startDate: "2031-03-03", isEditing: true, onSave });
    fireEvent.click(container.querySelector<HTMLButtonElement>(".event-form-footer .btn-primary")!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("CreateEventForm repeat", () => {
  it("offers repeat options for all-day events and hides the time pickers", () => {
    const setRecurrence = vi.fn();
    const { container, getByRole } = renderForm({ startDate: "2024-06-10", allDay: true, setRecurrence });
    expect(container.querySelector(".time-picker-start")).toBeNull();
    fireEvent.change(getByRole("combobox", { name: "Repeat" }), { target: { value: "FREQ=WEEKLY" } });
    expect(setRecurrence).toHaveBeenCalledWith("FREQ=WEEKLY");
  });

  it("goes back to no repeat", () => {
    const setRecurrence = vi.fn();
    const { getByRole } = renderForm({ startDate: "2024-06-10", setRecurrence });
    fireEvent.change(getByRole("combobox", { name: "Repeat" }), { target: { value: "" } });
    expect(setRecurrence).toHaveBeenCalledWith(null);
  });
});

describe("CreateEventForm fields and footer", () => {
  it("labels its location and guests rows like the compose form's", () => {
    const setLocation = vi.fn();
    const { getByLabelText, container } = renderForm({ startDate: "2031-03-03", extra: { setLocation } });
    const location = getByLabelText("Location") as HTMLInputElement;
    expect(location.closest(".form-field-row")).not.toBeNull();
    fireEvent.input(location, { target: { value: "Studio 2" } });
    expect(setLocation).toHaveBeenCalledWith("Studio 2");
    expect(container.querySelector("label[for]:not([for=''])")).not.toBeNull();
    expect((getByLabelText("Guests") as HTMLElement).closest(".form-field-row")).not.toBeNull();
  });

  it("ends in the shared footer, with Cancel showing Escape", () => {
    const onClose = vi.fn();
    const { container, getByRole } = renderForm({ startDate: "2031-03-03", onClose });
    const footer = container.querySelector(".form-footer.event-form-footer")!;
    const cancel = getByRole("button", { name: /Cancel/ });
    expect(footer.contains(cancel)).toBe(true);
    expect(cancel.querySelector(".shortcut-hint")).toHaveTextContent("ESC");
    fireEvent.click(cancel);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a failed save in the footer, announced", () => {
    const { container } = renderForm({ startDate: "2031-03-03", extra: { error: "Couldn't save the event." } });
    expect(container.querySelector('.form-footer [role="alert"]')).toHaveTextContent("Couldn't save the event.");
  });
});
