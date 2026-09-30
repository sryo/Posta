// The eight reactions on the reaction wheel. Each keeps its place on the ring,
// so a reach becomes habit; an emoji used more takes over the least used
// place, and only that one.

export type Reaction = { emoji: string; label: string };

// Clockwise from the top
export const DEFAULT_REACTIONS: Reaction[] = [
  { emoji: "🔥", label: "Fire" },
  { emoji: "✅", label: "Done" },
  { emoji: "👌", label: "Ok" },
  { emoji: "🤌", label: "Chef's kiss" },
  { emoji: "🫡", label: "On it" },
  { emoji: "👀", label: "Seen" },
  { emoji: "💀", label: "Dead" },
  { emoji: "🫶", label: "Love" },
];

// A use counts half as much after this long, so an old habit gives its place up
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
// How far ahead of the least used place an emoji must be to take it
const TAKEOVER_MARGIN = 2;
// Uses a moment apart have hardly faded, and still count as whole ones
const FADE_TOLERANCE = 0.01;

type Tally = { score: number; at: number };
export type ReactionState = { slots: string[]; tallies: Record<string, Tally> };

const STORAGE_KEY = "posta.reactions";

const decayed = (tally: Tally | undefined, now: number) =>
  tally ? tally.score * Math.pow(0.5, (now - tally.at) / HALF_LIFE_MS) : 0;

export function initialReactionState(): ReactionState {
  return { slots: DEFAULT_REACTIONS.map(r => r.emoji), tallies: {} };
}

// Counts one use; the emoji takes the least used place once it is clearly
// ahead of it. The other places never move.
export function recordReaction(state: ReactionState, emoji: string, now = Date.now()): ReactionState {
  const tallies = { ...state.tallies, [emoji]: { score: decayed(state.tallies[emoji], now) + 1, at: now } };
  const slots = [...state.slots];
  if (!slots.includes(emoji)) {
    // Of places used as little, the last goes first: the top is the easiest reach
    let weakest = 0;
    for (let i = 1; i < slots.length; i++) {
      if (decayed(tallies[slots[i]], now) <= decayed(tallies[slots[weakest]], now)) weakest = i;
    }
    if (tallies[emoji].score + FADE_TOLERANCE >= decayed(tallies[slots[weakest]], now) + TAKEOVER_MARGIN) slots[weakest] = emoji;
  }
  return { slots, tallies };
}

// An emoji that took a place has no word of its own; it is its own name
export function wheelReactions(state: ReactionState): Reaction[] {
  return state.slots.map(emoji => DEFAULT_REACTIONS.find(r => r.emoji === emoji) ?? { emoji, label: emoji });
}

export function loadReactionState(): ReactionState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialReactionState();
    const parsed = JSON.parse(raw) as ReactionState;
    if (!Array.isArray(parsed.slots) || parsed.slots.length !== DEFAULT_REACTIONS.length) return initialReactionState();
    return { slots: parsed.slots, tallies: parsed.tallies ?? {} };
  } catch {
    return initialReactionState();
  }
}

export function saveReactionState(state: ReactionState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Without storage the wheel keeps its places for this session only
  }
}
