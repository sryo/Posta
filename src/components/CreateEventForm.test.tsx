import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { CreateEventForm } from "./CreateEventForm";

function renderForm(init: { startDate: string; endDate?: string; startTime?: string; endTime?: string; isEditing?: boolean }) {
  const [startDate, setStartDate] = createSignal(init.startDate);
  const [endDate, setEndDate] = createSignal(init.endDate ?? init.startDate);
  const [startTime, setStartTime] = createSignal(init.startTime ?? "10:00");
  const [endTime, setEndTime] = createSignal(init.endTime ?? "11:00");
  const result = render(() => (
    <CreateEventForm
      onClose={vi.fn()}
      summary="Trip"
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
      allDay={false}
      setAllDay={vi.fn()}
      attendees=""
      setAttendees={vi.fn()}
      recurrence={null}
      setRecurrence={vi.fn()}
      saving={false}
      onSave={vi.fn()}
      error={null}
      isEditing={init.isEditing}
    />
  ));
  return { ...result, startDate, endDate, startTime, endTime };
}

const selects = (container: HTMLElement) => container.querySelectorAll<HTMLSelectElement>(".scheduler-header select");
const firstDayCard = (container: HTMLElement) => container.querySelector(".scheduler-day-card")!.textContent;

const slot = (container: HTMLElement, picker: "start" | "end", time: string) =>
  Array.from(container.querySelectorAll<HTMLElement>(`.time-picker-${picker} > div`)).find(el => el.textContent === time)!;

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

