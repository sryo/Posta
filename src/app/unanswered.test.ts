import { describe, expect, it } from "vitest";
import type { Thread } from "../api/tauri";
import { unansweredLine } from "./unanswered";

const L = "en-US";
const own = ["me@posta.test"];
// Ana wrote on Friday, Sep 25 2026 at 4:12 PM
const friday = new Date(2026, 8, 25, 16, 12).getTime();
const thread = (over: Partial<Thread> = {}): Thread => ({
  gmail_thread_id: "t", account_id: "a", subject: "Venue for the offsite", snippet: "", last_message_date: friday,
  unread_count: 0, labels: ["INBOX"], participants: ["Ana Pérez <ana@acme.co>", "me@posta.test"],
  has_attachment: false, attachments: [], calendar_event: null,
  last_sender: "Ana Pérez <ana@acme.co>", last_from_list: false, ...over,
});
const on = (month: number, day: number, hour = 10) => new Date(2026, month - 1, day, hour);
const line = (now: Date, over: Partial<Thread> = {}) => unansweredLine(thread(over), own, now, L);

describe("unansweredLine", () => {
  it("waits for two working days, so a Friday letter doesn't nag on Monday", () => {
    expect(line(on(9, 26))).toBeNull();
    expect(line(on(9, 27))).toBeNull();
    expect(line(on(9, 28))).toBeNull();
    expect(line(on(9, 29, 8))).toBe("Unanswered since Friday");
  });

  it("says for how long once a week has gone by, then the date", () => {
    expect(line(on(10, 1))).toBe("Unanswered since Friday");
    expect(line(on(10, 2))).toBe("Unanswered for a week");
    expect(line(on(10, 8))).toBe("Unanswered for a week");
    expect(line(on(10, 9))).toBe("Unanswered for two weeks");
    expect(line(on(10, 15))).toBe("Unanswered for two weeks");
    expect(line(on(10, 16))).toBe("Unanswered since Sep 25");
  });

  it("names the year of a letter from another year", () => {
    expect(line(new Date(2027, 0, 20))).toBe("Unanswered since Sep 25, 2026");
  });

  it("says nothing once you've replied", () => {
    expect(line(on(10, 1), { last_sender: "Me <ME@posta.test>" })).toBeNull();
  });

  it("says nothing about a robot or a mailing list", () => {
    expect(line(on(10, 1), { last_sender: "Figma <no-reply@figma.com>" })).toBeNull();
    expect(line(on(10, 1), { last_sender: "notifications@github.com" })).toBeNull();
    expect(line(on(10, 1), { last_from_list: true })).toBeNull();
  });

  it("says nothing about unread, archived or invite threads, or one that doesn't say who wrote last", () => {
    expect(line(on(10, 1), { unread_count: 1 })).toBeNull();
    expect(line(on(10, 1), { labels: [] })).toBeNull();
    expect(line(on(10, 1), { last_sender: undefined })).toBeNull();
    expect(line(on(10, 1), { calendar_event: { uid: "x" } as Thread["calendar_event"] })).toBeNull();
  });
});
