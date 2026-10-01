// Posta's two sounds, off until turned on in Settings: two soft notes a
// fifth apart once a message has actually gone, after its Undo, and a lower
// single note for new mail in the cards chosen for it. Synthesised with Web
// Audio, so they play through the Mac's output at its volume and not at all
// while it is muted.

import { createEffect, createSignal } from "solid-js";
import type { ThreadGroup } from "../api/tauri";
import { safeGetItem, safeGetJSON, safeSetItem, safeSetJSON } from "../shared/storage";

const ENABLED_KEY = "soundsEnabled";
const CARDS_KEY = "soundArrivalCards";

const [enabled, setEnabled] = createSignal(safeGetItem(ENABLED_KEY) === "true");
const [cards, setCards] = createSignal<ReadonlySet<string>>(new Set(safeGetJSON<string[]>(CARDS_KEY, [])));

export const soundsEnabled = enabled;
export const arrivalCards = cards;

export function setSoundsEnabled(on: boolean): void {
  setEnabled(on);
  safeSetItem(ENABLED_KEY, String(on));
}

export function setArrivalCard(cardId: string, on: boolean): void {
  const next = new Set(cards());
  if (on) next.add(cardId);
  else next.delete(cardId);
  setCards(next);
  safeSetJSON(CARDS_KEY, [...next]);
}

export type Cue = "sent" | "arrived";

let context: AudioContext | null = null;
function audio(): AudioContext | null {
  if (context) return context;
  const Context = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  try {
    context = new Context();
  } catch {
    return null;
  }
  return context;
}

// A sine with quiet octave and twelfth partials, a 4 ms attack and an
// exponential decay, through a gentle lowpass
function note(ac: AudioContext, at: number, freq: number, dur: number, gain: number) {
  const out = ac.createGain();
  out.gain.value = 0;
  const lowpass = ac.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 3200;
  lowpass.Q.value = 0.3;
  out.connect(lowpass);
  lowpass.connect(ac.destination);
  for (const [mult, amp] of [[1, 1], [2, 0.12], [3, 0.03]]) {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * mult;
    const partial = ac.createGain();
    partial.gain.value = amp;
    osc.connect(partial);
    partial.connect(out);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }
  out.gain.setValueAtTime(0, at);
  out.gain.linearRampToValueAtTime(gain, at + 0.004);
  out.gain.exponentialRampToValueAtTime(0.0001, at + dur);
}

// Plays the cue whether sounds are on or not: Settings plays it to be heard
export function playCue(kind: Cue): void {
  const ac = audio();
  if (!ac) return;
  void ac.resume?.().catch(() => {});
  const t = ac.currentTime + 0.02;
  if (kind === "sent") {
    note(ac, t, 784, 0.16, 0.09);
    note(ac, t + 0.085, 1175, 0.2, 0.07);
  } else {
    note(ac, t, 523.25, 0.32, 0.08);
  }
}

export function cue(kind: Cue): void {
  if (enabled()) playCue(kind);
}

// WebKit keeps an AudioContext silent until a click or key starts it; a
// gesture while sounds are on starts it, so a cue later can play
export function listenForAudioGesture(target: Document): () => void {
  const wake = () => {
    if (enabled()) void audio()?.resume?.().catch(() => {});
  };
  target.addEventListener("pointerdown", wake, true);
  target.addEventListener("keydown", wake, true);
  return () => {
    target.removeEventListener("pointerdown", wake, true);
    target.removeEventListener("keydown", wake, true);
  };
}

// When the newest unread mail a card shows was written
export function latestUnread(groups: readonly ThreadGroup[]): number | null {
  let latest: number | null = null;
  for (const group of groups) {
    for (const t of group.threads) {
      if (t.unread_count > 0 && (latest === null || t.last_message_date > latest)) latest = t.last_message_date;
    }
  }
  return latest;
}

// New mail: unread mail newer than any the card showed before, written since
// Posta started. A card's first showing, a page of older mail or a thread
// marked unread again isn't.
export function newMailArrived(seen: number | undefined, latest: number | null, startedAt: number): boolean {
  return seen !== undefined && latest !== null && latest > seen && latest > startedAt;
}

// Plays the new-mail note when a chosen card gets new mail
export function watchNewMail(groupsOf: (cardId: string) => readonly ThreadGroup[] | undefined, startedAt = Date.now()): void {
  const seen = new Map<string, number>();
  createEffect(() => {
    const chosen = enabled() ? cards() : new Set<string>();
    for (const id of [...seen.keys()]) if (!chosen.has(id)) seen.delete(id);
    let arrived = false;
    for (const id of chosen) {
      const groups = groupsOf(id);
      if (!groups) continue;
      const latest = latestUnread(groups);
      if (newMailArrived(seen.get(id), latest, startedAt)) arrived = true;
      seen.set(id, Math.max(seen.get(id) ?? 0, latest ?? 0));
    }
    if (arrived) playCue("arrived");
  });
}
