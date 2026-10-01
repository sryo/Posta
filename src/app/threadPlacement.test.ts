import { describe, expect, it } from "vitest";
import type { Thread, ThreadGroup } from "../api/tauri";
import { dateGroupLabel, placeInCards, placeThread } from "./threadPlacement";

// Wednesday 1 October 2026, 12:00 local
const now = new Date(2026, 9, 1, 12, 0);
const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();
const t = (id: string, date: number): Thread => ({
  gmail_thread_id: id, account_id: "a", subject: id, snippet: "", last_message_date: date,
  unread_count: 0, labels: [], participants: [], has_attachment: false, attachments: [], calendar_event: null,
});
const ids = (groups: ThreadGroup[]) => groups.map(g => `${g.label}: ${g.threads.map(x => x.gmail_thread_id).join(" ")}`);

describe("dateGroupLabel", () => {
  it("names the bucket the backend groups a date into", () => {
    expect(dateGroupLabel(at(1, 8), now)).toBe("Today");
    expect(dateGroupLabel(at(2, 8), now)).toBe("Today");
    expect(dateGroupLabel(new Date(2026, 8, 30, 9).getTime(), now)).toBe("Yesterday");
    expect(dateGroupLabel(new Date(2026, 8, 29, 9).getTime(), now)).toBe("This week");
    expect(dateGroupLabel(new Date(2026, 8, 20, 9).getTime(), now)).toBe("Last 30 days");
    expect(dateGroupLabel(new Date(2026, 6, 1, 9).getTime(), now)).toBe("Older");
  });
});

describe("placeThread", () => {
  const groups: ThreadGroup[] = [
    { label: "Today", threads: [t("a", at(1, 11)), t("b", at(1, 8))] },
    { label: "Last 30 days", threads: [t("c", new Date(2026, 8, 20).getTime())] },
  ];

  it("puts the thread in date order inside its own group", () => {
    expect(ids(placeThread(groups, t("n", at(1, 9)), now, true)!)).toEqual(["Today: a n b", "Last 30 days: c"]);
    expect(ids(placeThread(groups, t("n", at(1, 11) + 1), now, true)!)).toEqual(["Today: n a b", "Last 30 days: c"]);
  });

  it("opens its group where the backend would put it", () => {
    expect(ids(placeThread(groups, t("n", new Date(2026, 8, 30, 9).getTime()), now, true)!)).toEqual([
      "Today: a b", "Yesterday: n", "Last 30 days: c",
    ]);
  });

  it("leaves a thread older than the last one loaded to the next page", () => {
    expect(placeThread(groups, t("n", new Date(2026, 6, 1).getTime()), now, false)).toBeNull();
    expect(ids(placeThread(groups, t("n", new Date(2026, 6, 1).getTime()), now, true)!)).toEqual([
      "Today: a b", "Last 30 days: c", "Older: n",
    ]);
  });

  it("places it into an empty card", () => {
    expect(ids(placeThread([], t("n", at(1, 9)), now, true)!)).toEqual(["Today: n"]);
  });

  it("doesn't place a thread the card already has", () => {
    expect(placeThread(groups, t("a", at(1, 11)), now, true)).toBeNull();
  });
});

describe("placeInCards", () => {
  const labelId = (name: string) => (name === "receipts" ? "Label_1" : undefined);
  const cards = [
    { id: "starred", query: "is:starred", groups: [{ label: "Today", threads: [t("x", at(1, 7))] }], complete: true },
    { id: "unread", query: "is:unread", groups: [], complete: true },
    { id: "receipts", query: "label:receipts", groups: [], complete: true },
    { id: "ana", query: "from:ana is:starred", groups: [], complete: true },
  ];

  it("places the thread in every card whose query its labels answer", () => {
    const placed = placeInCards(cards, { ...t("n", at(1, 9)), labels: ["INBOX", "STARRED"] }, labelId, now);
    expect(Object.keys(placed)).toEqual(["starred"]);
    expect(ids(placed.starred)).toEqual(["Today: n x"]);
  });

  it("counts an unread thread as carrying UNREAD", () => {
    const placed = placeInCards(cards, { ...t("n", at(1, 9)), labels: ["Label_1"], unread_count: 1 }, labelId, now);
    expect(Object.keys(placed)).toEqual(["unread", "receipts"]);
  });
});
