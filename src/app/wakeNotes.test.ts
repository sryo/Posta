import { afterEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "../api/tauri";
import { createWakeWatch, wakeNotes } from "./wakeNotes";

const at = (h: number, m: number, day = 1) => new Date(2026, 9, day, h, m).getTime();
const thread = (id: string, subject: string, date: number, from: string, unread = 1): Thread => ({
  gmail_thread_id: id, account_id: "a", subject, snippet: "", last_message_date: date, unread_count: unread,
  labels: [], participants: [from], has_attachment: false, attachments: [], calendar_event: null,
});
const cards = [{ id: "clients", name: "Clients" }, { id: "inbox", name: "Inbox" }, { id: "receipts", name: "Receipts" }];
const sleptAt = at(23, 10, 1);

describe("wakeNotes", () => {
  it("gives each card that got mail while the Mac slept one note, naming the latest", () => {
    const threads: Record<string, Thread[]> = {
      clients: [
        thread("c1", "Scope questions", at(1, 5, 2), "Marco Bellini <marco@x.com>"),
        thread("c2", "Contract v3 signed", at(6, 50, 2), "Lena Ortiz <lena@x.com>"),
        thread("c0", "Kickoff", at(18, 0, 1), "Lena Ortiz <lena@x.com>"),
      ],
      inbox: [thread("i1", "Lunch?", at(7, 0, 2), "ben@x.com")],
      receipts: [thread("r1", "Your order shipped", at(2, 0, 2), "shop@x.com", 0)],
    };
    expect(wakeNotes(cards, id => threads[id] ?? [], sleptAt, at(7, 42, 2), [], "en-GB")).toEqual([
      { card_id: "clients", title: "Since 23:10", body: "Clients: 2 new, latest from Lena Ortiz: Contract v3 signed" },
      { card_id: "inbox", title: "Since 23:10", body: "Inbox: 1 new from ben@x.com: Lunch?" },
    ]);
  });

  it("names someone other than you when you're on the latest thread", () => {
    const threads = [thread("c1", "Re: Scope", at(1, 5, 2), "me@x.com")];
    threads[0].participants = ["me@x.com", "Marco Bellini <marco@x.com>"];
    expect(wakeNotes(cards, id => (id === "clients" ? threads : []), sleptAt, at(7, 42, 2), ["ME@x.com"], "en-GB")[0].body)
      .toBe("Clients: 1 new from Marco Bellini: Re: Scope");
  });

  it("names the day it slept when that was before yesterday", () => {
    const threads = [thread("c1", "Hello", at(9, 0, 5), "ana@x.com")];
    expect(wakeNotes(cards, id => (id === "inbox" ? threads : []), at(18, 0, 2), at(9, 5, 5), [], "en-GB")[0].title).toBe("Since Fri 18:00");
  });
});

describe("createWakeWatch", () => {
  afterEach(() => { vi.useRealTimers(); });

  function setup() {
    vi.useFakeTimers();
    const post = vi.fn((_sleptAt: number) => {});
    return { post, watch: createWakeWatch(post, { quiet: 1000, giveUp: 10_000 }) };
  }

  it("posts once the syncs after waking have gone quiet", async () => {
    const { post, watch } = setup();
    watch.wake(sleptAt);
    watch.synced();
    await vi.advanceTimersByTimeAsync(800);
    watch.synced();
    await vi.advanceTimersByTimeAsync(800);
    expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(post).toHaveBeenCalledExactlyOnceWith(sleptAt);
    watch.synced();
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("ignores syncs while the Mac hasn't slept", async () => {
    const { post, watch } = setup();
    watch.synced();
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).not.toHaveBeenCalled();
  });

  it("counts from the first sleep when the Mac sleeps again before syncing", async () => {
    const { post, watch } = setup();
    watch.wake(sleptAt);
    watch.wake(sleptAt + 3_600_000);
    watch.synced();
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledExactlyOnceWith(sleptAt);
  });

  it("gives up when nothing syncs after waking", async () => {
    const { post, watch } = setup();
    watch.wake(sleptAt);
    await vi.advanceTimersByTimeAsync(10_000);
    watch.synced();
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).not.toHaveBeenCalled();
  });
});
