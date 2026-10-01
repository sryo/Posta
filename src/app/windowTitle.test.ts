import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoogleCalendarEvent } from "../api/tauri";
import { boardTitle, createTitleSync } from "./windowTitle";

const at = (h: number, m: number) => new Date(2026, 9, 1, h, m).getTime();
const event = (title: string, start: number, end: number | null, extra: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent => ({
  id: title, calendar_id: "c", calendar_name: "Work", title, description: null, location: null,
  start_time: start, end_time: end, all_day: false, status: "confirmed", organizer: null, attendees: [],
  html_link: null, hangout_link: null, response_status: "accepted", can_edit: true, ...extra,
});
const quiet = { events: [], offlineSince: null, unread: 0 };
const title = (facts: Partial<Parameters<typeof boardTitle>[0]>, now: number) => boardTitle({ ...quiet, ...facts }, now, "en-US");

describe("boardTitle", () => {
  it("is just the app name when nothing needs saying", () => {
    expect(title({}, at(9, 0))).toBe("Posta");
  });

  it("counts unread mail", () => {
    expect(title({ unread: 4 }, at(9, 0))).toBe("4 unread — Posta");
  });

  it("says since when the board has been offline, before the unread count", () => {
    expect(title({ unread: 4, offlineSince: at(10, 42) }, at(11, 0))).toBe("Offline since 10:42 AM — Posta");
  });

  it("names the meeting you're in and when it ends, before being offline", () => {
    const review = event("Design review", at(14, 0), at(15, 30));
    expect(title({ events: [review], offlineSince: at(10, 42), unread: 4 }, at(14, 20))).toBe("Design review until 3:30 PM — Posta");
  });

  it("puts a meeting starting within ten minutes first, counting down in minutes", () => {
    const review = event("Design review", at(14, 0), at(15, 0));
    const standup = event("Standup", at(15, 6), at(15, 20));
    expect(title({ events: [review, standup], unread: 4 }, at(15, 0))).toBe("Standup in 6 minutes — Posta");
    expect(title({ events: [standup] }, at(15, 5) + 30_000)).toBe("Standup in 1 minute — Posta");
    expect(title({ events: [standup] }, at(14, 55))).toBe("Posta");
  });

  it("leaves out all-day, cancelled and declined events", () => {
    const events = [
      event("Holiday", at(0, 0), at(23, 59), { all_day: true }),
      event("Moved", at(9, 5), at(10, 0), { status: "cancelled" }),
      event("Skipping", at(9, 5), at(10, 0), { response_status: "declined" }),
    ];
    expect(title({ events }, at(9, 0))).toBe("Posta");
  });

  it("gives an event with no end half an hour", () => {
    expect(title({ events: [event("Call", at(9, 0), null)] }, at(9, 20))).toBe("Call until 9:30 AM — Posta");
    expect(title({ events: [event("Call", at(9, 0), null)] }, at(9, 30))).toBe("Posta");
  });
});

describe("createTitleSync", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("applies only the last title of a burst, once it settles, and skips repeats", async () => {
    vi.useFakeTimers();
    const apply = vi.fn(async (_title: string) => {});
    const sync = createTitleSync(apply, 500);
    sync("3 unread — Posta");
    sync("4 unread — Posta");
    await vi.advanceTimersByTimeAsync(499);
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(apply).toHaveBeenCalledExactlyOnceWith("4 unread — Posta");

    sync("4 unread — Posta");
    await vi.advanceTimersByTimeAsync(1000);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("keeps going when titling the window throws outright", async () => {
    vi.useFakeTimers();
    const apply = vi.fn((_title: string): Promise<void> => { throw new TypeError("setTitle is not a function"); });
    const sync = createTitleSync(apply, 10);
    sync("Posta");
    await vi.advanceTimersByTimeAsync(10);
    sync("Posta");
    await vi.advanceTimersByTimeAsync(10);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("tries a failed title again next time", async () => {
    vi.useFakeTimers();
    const apply = vi.fn(async (_title: string): Promise<void> => { throw new Error("no window"); });
    const sync = createTitleSync(apply, 10);
    sync("Posta");
    await vi.advanceTimersByTimeAsync(10);
    apply.mockImplementation(async () => {});
    sync("Posta");
    await vi.advanceTimersByTimeAsync(10);
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
