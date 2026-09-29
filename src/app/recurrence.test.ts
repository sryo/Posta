import { describe, expect, it } from "vitest";
import { deletedByScope } from "./recurrence";

const ev = (id: string, start_time: number, recurring_event_id: string | null = "s1") => ({ id, start_time, recurring_event_id });

describe("deletedByScope", () => {
  const deleted = ev("s1_2", 2);
  const others = [ev("s1_1", 1), ev("s1_2", 2), ev("s1_3", 3), ev("other", 3, null), ev("s2_3", 3, "s2")];
  const gone = (scope: "this" | "following" | "all") => others.filter(e => deletedByScope(e, deleted, scope)).map(e => e.id);

  it("takes only the occurrence for this event", () => {
    expect(gone("this")).toEqual(["s1_2"]);
  });

  it("takes the occurrence and the later ones of its series for this and following", () => {
    expect(gone("following")).toEqual(["s1_2", "s1_3"]);
  });

  it("takes every occurrence of the series for all events", () => {
    expect(gone("all")).toEqual(["s1_1", "s1_2", "s1_3"]);
  });

  it("takes only the event itself when it doesn't repeat", () => {
    expect(deletedByScope(ev("other", 3, null), ev("other", 3, null), "all")).toBe(true);
    expect(deletedByScope(ev("x", 3, null), ev("other", 3, null), "all")).toBe(false);
  });
});
