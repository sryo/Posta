import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import type { Thread } from "../api/tauri";
import { createLiveThreadMatch, findLiveThread, liveThreadLine, liveThreadQuery, normalizeSubject } from "./liveThread";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 1, 12).getTime();
const OWN = ["me@x.com"];
const thread = (id: string, subject: string, participants: string[], daysAgo: number): Thread => ({
  gmail_thread_id: id, account_id: "a", subject, snippet: "", last_message_date: NOW - daysAgo * DAY,
  unread_count: 0, labels: [], participants, has_attachment: false, attachments: [], calendar_event: null,
});
const budget = thread("t-1", "Re: Q3 budget", ["Ana Pérez <ana@x.com>", "me@x.com"], 6);

describe("normalizeSubject", () => {
  it("drops reply and forward prefixes, case and surrounding punctuation", () => {
    expect(normalizeSubject("Re: RE: Fwd: Q3 budget")).toBe("q3 budget");
    expect(normalizeSubject("RV: “Q3  budget”!")).toBe("q3 budget");
    expect(normalizeSubject("FW:Q3 budget")).toBe("q3 budget");
  });
});

describe("findLiveThread", () => {
  it("finds a recent thread with the same subject that everyone in To is part of", () => {
    expect(findLiveThread("Q3 budget", ["ana@x.com"], [budget], OWN, NOW)).toBe(budget);
    expect(findLiveThread("q3 budget.", ["Ana <ANA@x.com>"], [budget], OWN, NOW)).toBe(budget);
  });

  it("matches the whole subject only", () => {
    expect(findLiveThread("Q3 budget draft", ["ana@x.com"], [budget], OWN, NOW)).toBeNull();
  });

  it("needs every person in To to be in the thread", () => {
    expect(findLiveThread("Q3 budget", ["ana@x.com", "ben@x.com"], [budget], OWN, NOW)).toBeNull();
    expect(findLiveThread("Q3 budget", [], [budget], OWN, NOW)).toBeNull();
  });

  it("lets a thread quiet for more than 45 days start again", () => {
    expect(findLiveThread("Q3 budget", ["ana@x.com"], [{ ...budget, last_message_date: NOW - 46 * DAY }], OWN, NOW)).toBeNull();
  });

  it("never matches a generic or short subject", () => {
    for (const subject of ["Hola", "Question", "Follow up", "Re: update", "Hi!", "Q3"]) {
      expect(findLiveThread(subject, ["ana@x.com"], [thread("t", `Re: ${subject}`, ["ana@x.com"], 1)], OWN, NOW)).toBeNull();
    }
  });

  it("picks the most recent of several", () => {
    const later = { ...budget, gmail_thread_id: "t-2", last_message_date: NOW - DAY };
    expect(findLiveThread("Q3 budget", ["ana@x.com"], [budget, later], OWN, NOW)).toBe(later);
  });
});

describe("liveThreadQuery", () => {
  it("searches the subject over the last 45 days", () => {
    expect(liveThreadQuery("Re: Q3 \"budget\"")).toBe('subject:"Q3 budget" newer_than:45d');
  });
});

describe("liveThreadLine", () => {
  it("names who is already talking, the subject and when it last moved", () => {
    expect(liveThreadLine(budget, ["ana@x.com"], OWN, undefined, new Date(NOW), "en-US"))
      .toBe('You and Ana already have "Q3 budget" going, last on Sep 25.');
    expect(liveThreadLine({ ...budget, last_message_date: NOW - DAY / 2 }, ["ana@x.com", "Ben <ben@x.com>"], OWN, undefined, new Date(NOW), "en-US"))
      .toBe('You, Ana and Ben already have "Q3 budget" going, last today.');
  });
});

describe("createLiveThreadMatch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(threads: Thread[], search = vi.fn(async (_q: string) => [] as Thread[])) {
    const [subject, setSubject] = createSignal("");
    const [to, setTo] = createSignal<string[]>([]);
    const [active, setActive] = createSignal(true);
    let dispose = () => {};
    const match = createRoot(d => {
      dispose = d;
      return createLiveThreadMatch({ active, subject, to, threads: () => threads, ownEmails: () => OWN, now: () => NOW, search });
    });
    return { match, setSubject, setTo, setActive, search, dispose };
  }

  it("finds the thread once typing stops for 600 ms, and drops it when the subject changes", async () => {
    const { match, setSubject, setTo, dispose } = setup([budget]);
    setTo(["ana@x.com"]);
    setSubject("Q3 budget");
    await vi.advanceTimersByTimeAsync(599);
    expect(match()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(match()).toBe(budget);
    setSubject("Q3 budget draft");
    expect(match()).toBeNull();
    dispose();
  });

  it("asks Gmail when the loaded mail has no match", async () => {
    const search = vi.fn(async (_q: string) => [budget]);
    const { match, setSubject, setTo, dispose } = setup([], search);
    setTo(["ana@x.com"]);
    setSubject("Q3 budget");
    await vi.advanceTimersByTimeAsync(600);
    expect(search).toHaveBeenCalledWith('subject:"Q3 budget" newer_than:45d');
    expect(match()).toBe(budget);
    dispose();
  });

  it("does nothing while inactive", async () => {
    const { match, setSubject, setTo, setActive, search, dispose } = setup([budget]);
    setActive(false);
    setTo(["ana@x.com"]);
    setSubject("Q3 budget");
    await vi.advanceTimersByTimeAsync(600);
    expect(match()).toBeNull();
    expect(search).not.toHaveBeenCalled();
    dispose();
  });
});
