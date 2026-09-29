import { describe, expect, it, vi } from "vitest";
import type { GoogleCalendarEvent } from "../api/tauri";
import { createInviteDayLookups, rangeDaysFor } from "./inviteDays";

const DAY = 86_400_000;
const NOW = new Date(2026, 8, 29, 10).getTime();

describe("rangeDaysFor", () => {
  it("rounds the days an invite needs up to a few fixed ranges, so cards share lookups", () => {
    expect(rangeDaysFor(NOW + 2 * 3_600_000, NOW)).toBe(7);
    expect(rangeDaysFor(NOW + 6 * DAY, NOW)).toBe(7);
    expect(rangeDaysFor(NOW + 8 * DAY, NOW)).toBe(14);
    expect(rangeDaysFor(NOW + 20 * DAY, NOW)).toBe(30);
    expect(rangeDaysFor(NOW + 80 * DAY, NOW)).toBe(90);
  });

  it("gives up on invites too far off", () => {
    expect(rangeDaysFor(NOW + 120 * DAY, NOW)).toBeNull();
  });
});

describe("createInviteDayLookups", () => {
  const setup = (fetch = vi.fn(async (_accountId: string, _query: string) => [] as GoogleCalendarEvent[])) => {
    let now = NOW;
    const onEvents = vi.fn();
    const lookups = createInviteDayLookups({ fetch, onEvents, now: () => now, maxAgeMs: 10 * 60_000 });
    return { fetch, onEvents, lookups, tick: (ms: number) => { now += ms; } };
  };
  const flush = () => new Promise(r => setTimeout(r, 0));

  it("asks the calendar once for the range every invite of an account needs", async () => {
    const { fetch, onEvents, lookups } = setup();
    lookups.request("a", NOW + DAY);
    lookups.request("a", NOW + 3 * DAY);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("a", "calendar:7d");
    expect(onEvents).toHaveBeenCalledWith("a", { events: [], until: NOW + 7 * DAY });
  });

  it("widens the range for a later invite", async () => {
    const { fetch, lookups } = setup();
    lookups.request("a", NOW + DAY);
    await flush();
    lookups.request("a", NOW + 10 * DAY);
    await flush();
    expect(fetch.mock.calls.map(c => c[1])).toEqual(["calendar:7d", "calendar:14d"]);
  });

  it("keeps accounts apart", async () => {
    const { fetch, lookups } = setup();
    lookups.request("a", NOW + DAY);
    lookups.request("b", NOW + DAY);
    await flush();
    expect(fetch.mock.calls.map(c => c[0])).toEqual(["a", "b"]);
  });

  it("asks again once the answer is old", async () => {
    const { fetch, lookups, tick } = setup();
    lookups.request("a", NOW + DAY);
    await flush();
    tick(5 * 60_000);
    lookups.request("a", NOW + DAY);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    tick(6 * 60_000);
    lookups.request("a", NOW + DAY);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports nothing when the calendar can't be read, and waits before trying again", async () => {
    const fetch = vi.fn(async () => { throw "Calendar permission denied"; });
    const { onEvents, lookups, tick } = setup(fetch);
    lookups.request("a", NOW + DAY);
    await flush();
    lookups.request("a", NOW + DAY);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onEvents).not.toHaveBeenCalled();
    tick(11 * 60_000);
    lookups.request("a", NOW + DAY);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("skips invites beyond the longest range", async () => {
    const { fetch, lookups } = setup();
    lookups.request("a", NOW + 200 * DAY);
    await flush();
    expect(fetch).not.toHaveBeenCalled();
  });
});
