import { beforeEach, describe, expect, it, vi } from "vitest";

let answer: (eventUid: string) => unknown = () => null;
const invoke = vi.fn(async (_cmd: string, args: Record<string, unknown> = {}) => answer(args.eventUid as string));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args) }));

import { inviteNamesEvent, rsvpSentMessage, rsvpWithFallback } from "./rsvp";

beforeEach(() => {
  invoke.mockClear();
  answer = () => null;
});

describe("rsvpWithFallback", () => {
  it("answers by the event's id", async () => {
    await rsvpWithFallback("a", "ev1", "accepted");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("rsvp_calendar_event", { accountId: "a", eventUid: "ev1", status: "accepted" });
  });

  it("retries by the iCalendar UID Google gives its own events", async () => {
    answer = uid => { if (uid === "ev1") throw "Event not found"; return null; };
    await rsvpWithFallback("a", "ev1", "declined");
    expect(invoke).toHaveBeenLastCalledWith("rsvp_calendar_event", { accountId: "a", eventUid: "ev1@google.com", status: "declined" });
  });

  it("does not retry other failures", async () => {
    answer = () => { throw "offline"; };
    await expect(rsvpWithFallback("a", "ev1", "accepted")).rejects.toBe("offline");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("rsvpSentMessage", () => {
  it("says the answer in the words the calendar cards use", () => {
    expect(rsvpSentMessage("accepted")).toBe("RSVP sent: Going");
    expect(rsvpSentMessage("tentative")).toBe("RSVP sent: Maybe");
    expect(rsvpSentMessage("declined")).toBe("RSVP sent: Not going");
  });
});

describe("inviteNamesEvent", () => {
  it("matches a calendar event to an invite's UID", () => {
    expect(inviteNamesEvent("ev1@google.com", "ev1")).toBe(true);
    expect(inviteNamesEvent("abc-123", "abc-123")).toBe(true);
    expect(inviteNamesEvent("ev1@google.com", "ev2")).toBe(false);
  });
});
