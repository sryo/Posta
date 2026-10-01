import { beforeEach, describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { createLastLook, newSinceLine } from "./newSince";

const L = "en-US";
const HOUR = 3_600_000;
// Thursday, Oct 1 2026, 3:10 PM
const now = new Date(2026, 9, 1, 15, 10);
const at = (month: number, day: number, hour: number, minute = 0) => new Date(2026, month - 1, day, hour, minute).getTime();
const arrivals = (count: number, after: number) => Array.from({ length: count }, (_, i) => after + (i + 1) * 60_000);

describe("newSinceLine", () => {
  const line = (lastLook: number, count = 3) => newSinceLine(arrivals(count, lastLook), lastLook, now, L);

  it("says nothing within the hour, or when nothing came", () => {
    expect(line(now.getTime() - 40 * 60_000)).toBeNull();
    expect(line(at(10, 1, 9, 40), 0)).toBeNull();
    expect(newSinceLine([at(10, 1, 9)], at(10, 1, 9, 40), now, L)).toBeNull();
  });

  it("names the gap as you'd remember it", () => {
    expect(line(at(10, 1, 9, 40), 3)).toMatch(/^3 new since 9:40\sAM$/);
    expect(line(at(9, 30, 23, 15), 6)).toBe("6 new since last night");
    expect(line(at(9, 30, 18, 0), 6)).toBe("6 new since last night");
    expect(line(at(9, 30, 14, 0), 8)).toBe("8 new since yesterday");
    expect(line(at(9, 25, 18, 12), 11)).toBe("11 new since Friday");
    expect(line(at(9, 22, 17, 0), 23)).toBe("23 new since Sep 22");
  });

  it("counts only what came after the last look", () => {
    expect(newSinceLine([at(10, 1, 8), at(10, 1, 10), at(10, 1, 11)], at(10, 1, 9, 40), now, L)).toMatch(/^2 new since/);
  });

  it("says nothing without a last look", () => {
    expect(newSinceLine([at(10, 1, 10)], null, now, L)).toBeNull();
  });
});

describe("createLastLook", () => {
  beforeEach(() => localStorage.clear());

  const make = (ids: string[], clock: { now: number }) => createRoot(() => createLastLook(() => ids, () => clock.now));

  it("starts from the last look kept from before, and a look clears it", () => {
    localStorage.setItem("lastLook", JSON.stringify({ a: at(9, 30, 23) }));
    const clock = { now: now.getTime() };
    const look = make(["a", "b"], clock);
    expect(look.since("a")).toBe(at(9, 30, 23));
    expect(look.since("b")).toBeNull();
    look.look("a");
    expect(look.since("a")).toBeNull();
    expect(JSON.parse(localStorage.getItem("lastLook")!).a).toBe(now.getTime());
  });

  it("keeps when the window was left and offers it on return after an hour or more", () => {
    const clock = { now: at(10, 1, 9) };
    const look = make(["a"], clock);
    window.dispatchEvent(new Event("blur"));
    clock.now += 30 * 60_000;
    window.dispatchEvent(new Event("focus"));
    expect(look.since("a")).toBeNull();
    window.dispatchEvent(new Event("blur"));
    const left = clock.now;
    clock.now += 2 * HOUR;
    window.dispatchEvent(new Event("focus"));
    expect(look.since("a")).toBe(left);
  });
});
