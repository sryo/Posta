import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadGroup, Thread } from "../api/tauri";

// Records the notes a cue schedules: each oscillator's frequency and start
class FakeAudioContext {
  static made = 0;
  state: "suspended" | "running" = "suspended";
  currentTime = 0;
  destination = {};
  oscillators: { frequency: number; startAt: number }[] = [];
  peaks: number[] = [];
  resume = vi.fn(async () => { this.state = "running"; });
  constructor() { FakeAudioContext.made++; }
  createGain() {
    const ctx = this;
    return {
      gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime(v: number) { ctx.peaks.push(v); }, exponentialRampToValueAtTime() {} },
      connect() {},
    };
  }
  createBiquadFilter() {
    return { type: "", frequency: { value: 0 }, Q: { value: 0 }, connect() {} };
  }
  createOscillator() {
    const ctx = this;
    const osc = {
      type: "",
      frequency: { value: 0 },
      connect() {},
      start(at: number) { ctx.oscillators.push({ frequency: osc.frequency.value, startAt: at }); },
      stop() {},
    };
    return osc;
  }
}

let sounds: typeof import("./sounds");
let context: FakeAudioContext | null;

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  FakeAudioContext.made = 0;
  context = null;
  vi.stubGlobal("AudioContext", class extends FakeAudioContext {
    constructor() { super(); context = this; }
  });
  sounds = await import("./sounds");
});

describe("sounds", () => {
  it("is off until turned on, and remembers being turned on", async () => {
    expect(sounds.soundsEnabled()).toBe(false);
    sounds.setSoundsEnabled(true);
    expect(sounds.soundsEnabled()).toBe(true);
    vi.resetModules();
    expect((await import("./sounds")).soundsEnabled()).toBe(true);
  });

  it("plays nothing while off, not even making an audio context", () => {
    sounds.cue("sent");
    sounds.cue("arrived");
    expect(FakeAudioContext.made).toBe(0);
  });

  it("plays two soft notes a fifth apart once a message has gone", () => {
    sounds.setSoundsEnabled(true);
    sounds.cue("sent");
    const notes = context!.oscillators.filter(o => o.frequency === 784 || o.frequency === 1175);
    expect(notes.map(n => n.frequency)).toEqual([784, 1175]);
    expect(notes[1].startAt).toBeGreaterThan(notes[0].startAt);
    expect(Math.max(...context!.peaks)).toBeLessThanOrEqual(0.09);
  });

  it("plays one lower note for new mail", () => {
    sounds.setSoundsEnabled(true);
    sounds.cue("arrived");
    expect(context!.oscillators.filter(o => o.frequency < 784).map(o => o.frequency)).toEqual([523.25]);
  });

  it("wakes the audio the webview held back until a gesture", () => {
    sounds.setSoundsEnabled(true);
    const stop = sounds.listenForAudioGesture(document);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
    expect(context!.resume).toHaveBeenCalled();
    stop();
  });

  it("remembers which cards to hear new mail in", async () => {
    sounds.setArrivalCard("card-a", true);
    sounds.setArrivalCard("card-b", true);
    sounds.setArrivalCard("card-a", false);
    expect([...sounds.arrivalCards()]).toEqual(["card-b"]);
    vi.resetModules();
    expect([...(await import("./sounds")).arrivalCards()]).toEqual(["card-b"]);
  });
});

describe("newMailArrived", () => {
  const unread = (date: number, count = 1): Thread => ({
    gmail_thread_id: `t${date}`, account_id: "a", subject: "", snippet: "", last_message_date: date,
    unread_count: count, labels: [], participants: [], has_attachment: false, attachments: [], calendar_event: null,
  });
  const groups = (...threads: Thread[]): ThreadGroup[] => [{ label: "Today", threads }];

  it("takes the newest unread mail of a card", () => {
    expect(sounds.latestUnread(groups(unread(10), unread(30), unread(50, 0)))).toBe(30);
    expect(sounds.latestUnread(groups(unread(50, 0)))).toBeNull();
  });

  it("is new mail when unread mail newer than the card showed came after Posta started", () => {
    expect(sounds.newMailArrived(20, 30, 0)).toBe(true);
    expect(sounds.newMailArrived(30, 30, 0)).toBe(false);
  });

  it("isn't new mail the first time the card shows, or mail from before Posta started", () => {
    expect(sounds.newMailArrived(undefined, 30, 0)).toBe(false);
    expect(sounds.newMailArrived(20, 30, 40)).toBe(false);
    expect(sounds.newMailArrived(20, null, 0)).toBe(false);
  });
});
