import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { CreateEventForm } from "./CreateEventForm";
import { formatClock, uses12HourClock } from "../app/dateFormat";

function renderForm(init: { startDate: string; endDate?: string; startTime?: string; endTime?: string; isEditing?: boolean; allDay?: boolean; setRecurrence?: (v: string | null) => void; summary?: string; onSave?: () => void; onClose?: () => void }) {
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
    />
  ));
  return { ...result, startDate, endDate, startTime, endTime };
}

const selects = (container: HTMLElement) => container.querySelectorAll<HTMLSelectElement>(".scheduler-header select");
const firstDayCard = (container: HTMLElement) => container.querySelector(".scheduler-day-card")!.textContent;

// A slot's label, as the locale writes the HH:MM time it stands for
const clock = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return formatClock(new Date(2000, 0, 1, h, m));
};
const slot = (container: HTMLElement, picker: "start" | "end", time: string) =>
  Array.from(container.querySelectorAll<HTMLElement>(`.time-picker-${picker} > div`)).find(el => el.textContent === clock(time))!;

// jsdom has no layout; the form scrolls the selected times into view on open
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("CreateEventForm time lists", () => {
  it("write the times as the locale does", () => {
    const { container } = renderForm({ startDate: "2030-06-10" });
    const labels = Array.from(container.querySelectorAll<HTMLElement>(".time-picker-start > div")).map(el => el.textContent);
    expect(labels).toContain(clock("14:30"));
    if (uses12HourClock()) expect(labels).not.toContain("14:30");
  });
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
  it("leaves Escape on a focused day to the hosting view", () => {
    const onClose = vi.fn();
    const { container } = renderForm({ startDate: "2025-03-10", onClose });
    fireEvent.keyDown(container.querySelector(".scheduler-day-card")!, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves Escape in the month picker to the picker", () => {
    const onClose = vi.fn();
    const { container } = renderForm({ startDate: "2025-03-10", onClose });
    fireEvent.keyDown(selects(container)[0], { key: "Escape" });
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

describe("CreateEventForm date navigation", () => {
  it("jumps to the chosen month even from the 31st", () => {
    const { container } = renderForm({ startDate: "2031-01-31" });
    const [month] = selects(container);
    fireEvent.change(month, { target: { value: "1" } });
    expect(month.value).toBe("1");
    // February 1st, 2031 is a Saturday
    expect(firstDayCard(container)).toBe("Sat1");
  });

  it("jumps to the chosen year even from Feb 29", () => {
    const { container } = renderForm({ startDate: "2028-02-29" });
    const [month, year] = selects(container);
    fireEvent.change(year, { target: { value: "2029" } });
    expect(month.value).toBe("1");
    // February 1st, 2029 is a Thursday
    expect(firstDayCard(container)).toBe("Thu1");
  });

  it("shows the year of an event outside the default range", () => {
    const { container } = renderForm({ startDate: "2019-06-10", isEditing: true });
    const [month, year] = selects(container);
    expect(year.value).toBe("2019");
    expect(month.value).toBe("5");
  });
});

describe("CreateEventForm keyboard access", () => {
  it("picks a day and a time with Enter or Space", () => {
    const { container, startDate, startTime } = renderForm({ startDate: "2031-03-03", startTime: "10:00", endTime: "11:00" });
    const days = container.querySelectorAll<HTMLElement>(".scheduler-day-card");
    expect(days[2].tabIndex).toBe(0);
    fireEvent.keyDown(days[2], { key: "Enter" });
    expect(startDate()).toBe("2031-03-05");
    const nine = slot(container, "start", "09:00");
    expect(nine.getAttribute("role")).toBe("option");
    fireEvent.keyDown(nine, { key: " " });
    expect(startTime()).toBe("09:00");
  });

  it("still saves with Cmd+Enter while a day or time is focused", () => {
    const onSave = vi.fn();
    const { container, startDate } = renderForm({ startDate: "2031-03-03", onSave });
    const days = container.querySelectorAll<HTMLElement>(".scheduler-day-card");
    fireEvent.keyDown(days[2], { key: "Enter", metaKey: true });
    fireEvent.keyDown(slot(container, "start", "09:00"), { key: "Enter", ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(startDate()).toBe("2031-03-03");
  });
});

describe("CreateEventForm time pickers", () => {
  it("keeps end after start on a single-day event", () => {
    const { container, endTime } = renderForm({ startDate: "2031-03-03", startTime: "10:00", endTime: "11:00" });
    fireEvent.click(slot(container, "end", "09:00"));
    expect(endTime()).toBe("11:00");
  });

  it("allows an end time earlier in the day than the start on a multi-day event", () => {
    const { container, endTime } = renderForm({
      startDate: "2031-03-03", endDate: "2031-03-05", startTime: "22:00", endTime: "23:00", isEditing: true,
    });
    fireEvent.click(slot(container, "end", "09:00"));
    expect(endTime()).toBe("09:00");
  });

  it("does not drag a multi-day event's end time along with its start", () => {
    const { container, endTime } = renderForm({
      startDate: "2031-03-03", endDate: "2031-03-05", startTime: "08:00", endTime: "09:00", isEditing: true,
    });
    fireEvent.click(slot(container, "start", "10:00"));
    expect(endTime()).toBe("09:00");
  });
});


describe("CreateEventForm repeat", () => {
  it("offers repeat options for all-day events and hides the time pickers", () => {
    const setRecurrence = vi.fn();
    const { container, getByText } = renderForm({ startDate: "2024-06-10", allDay: true, setRecurrence });
    expect(container.querySelector(".time-picker-start")).toBeNull();
    fireEvent.click(getByText("Weekly"));
    expect(setRecurrence).toHaveBeenCalledWith("FREQ=WEEKLY");
  });
});
