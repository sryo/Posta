import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_REACTIONS, initialReactionState, loadReactionState, recordReaction, saveReactionState, togglePin, wheelReactions } from "./reactions";

const DAY = 24 * 60 * 60 * 1000;

describe("reaction wheel places", () => {
  beforeEach(() => localStorage.clear());

  it("starts with the eight reactions, fire at the top", () => {
    expect(wheelReactions(initialReactionState()).map(r => r.emoji)).toEqual(["🔥", "✅", "👌", "🤌", "🫡", "👀", "💀", "🫶"]);
    expect(wheelReactions(initialReactionState())[3].label).toBe("Chef's kiss");
  });

  it("gives up the last place first when places are used as little, never fire at the top", () => {
    let state = recordReaction(initialReactionState(), "👍", 0);
    state = recordReaction(state, "👍", 5);
    expect(state.slots[0]).toBe("🔥");
    expect(state.slots[7]).toBe("👍");
  });

  it("never gives up a pinned place, taking the least used of the rest", () => {
    let state = togglePin(initialReactionState(), "🫶");
    expect(wheelReactions(state)[7].pinned).toBe(true);
    state = recordReaction(state, "👍", 0);
    state = recordReaction(state, "👍", 5);
    expect(state.slots[7]).toBe("🫶");
    expect(state.slots[6]).toBe("👍");
  });

  it("gives up nothing when every place is pinned", () => {
    let state = initialReactionState();
    for (const emoji of state.slots) state = togglePin(state, emoji);
    for (let n = 0; n < 5; n++) state = recordReaction(state, "👍", n);
    expect(state.slots).toEqual(initialReactionState().slots);
    expect(togglePin(state, "🔥").pinned).not.toContain("🔥");
  });

  it("keeps one use of another emoji off the wheel", () => {
    const state = recordReaction(initialReactionState(), "🦄", 0);
    expect(state.slots).toEqual(initialReactionState().slots);
  });

  it("gives a clearly more used emoji the least used place, and moves no other", () => {
    let state = initialReactionState();
    for (const emoji of DEFAULT_REACTIONS.map(r => r.emoji)) {
      if (emoji !== "💀") state = recordReaction(state, emoji, 0);
    }
    state = recordReaction(state, "👍", 0);
    expect(state.slots).not.toContain("👍");
    state = recordReaction(state, "👍", 0);
    expect(state.slots.indexOf("👍")).toBe(6);
    expect(state.slots.filter((_, i) => i !== 6)).toEqual(initialReactionState().slots.filter((_, i) => i !== 6));
    // Its own name is the emoji, having no word of its own
    expect(wheelReactions(state)[6]).toEqual({ emoji: "👍", label: "👍", pinned: false });
  });

  it("lets an old habit fade so a newer one can take its place", () => {
    let fresh = initialReactionState();
    for (const emoji of fresh.slots) for (let n = 0; n < 3; n++) fresh = recordReaction(fresh, emoji, 0);
    let now = fresh;
    for (let n = 0; n < 3; n++) now = recordReaction(now, "👍", 0);
    expect(now.slots).not.toContain("👍");
    // Months on, the places' three uses count for little and three new ones win
    let later = fresh;
    for (let n = 0; n < 3; n++) later = recordReaction(later, "👍", 120 * DAY);
    expect(later.slots).toContain("👍");
  });

  it("remembers the places, and falls back to the eight when what's stored is unusable", () => {
    const state = { slots: ["👍", ...initialReactionState().slots.slice(1)], tallies: {}, pinned: ["👍"] };
    saveReactionState(state);
    expect(loadReactionState()).toEqual(state);
    // Stored before pins existed
    localStorage.setItem("posta.reactions", JSON.stringify({ slots: state.slots, tallies: {} }));
    expect(loadReactionState().pinned).toEqual([]);
    localStorage.setItem("posta.reactions", "{not json");
    expect(loadReactionState()).toEqual(initialReactionState());
    localStorage.setItem("posta.reactions", JSON.stringify({ slots: ["👍"] }));
    expect(loadReactionState()).toEqual(initialReactionState());
  });
});
