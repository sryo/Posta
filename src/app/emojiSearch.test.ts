import { describe, expect, it } from "vitest";
import { searchEmoji } from "./emojiSearch";
import { EMOJI_NAMES } from "./emojiNames";

const cats = [
  { name: "Celebration", emojis: ["🎆", "🎉"] },
  { name: "Nature", emojis: ["🔥", "🌟"] },
  { name: "Gestures", emojis: ["👍", "👌", "🤌"] },
];

describe("searchEmoji", () => {
  it("finds an emoji by a word of its name, a whole word before one it only starts", () => {
    expect(searchEmoji("fire", cats)).toEqual(["🔥", "🎆"]);
  });

  it("finds it by the words people type that its name lacks", () => {
    expect(searchEmoji("chef", cats)).toEqual(["🤌"]);
    expect(searchEmoji("lit", cats)).toEqual(["🔥"]);
    expect(searchEmoji("ok", cats)).toEqual(["👍", "👌"]);
  });

  it("needs every typed word, each starting a word of the name", () => {
    expect(searchEmoji("thumbs up", cats)).toEqual(["👍"]);
    expect(searchEmoji("thumbs down", cats)).toEqual([]);
    expect(searchEmoji("ire", cats)).toEqual([]);
  });

  it("still finds what a category named for the query holds, after the names", () => {
    expect(searchEmoji("celebr", cats)).toEqual(["🎉", "🎆"]);
  });

  it("finds nothing for nothing typed", () => {
    expect(searchEmoji("  ", cats)).toEqual([]);
  });

  it("names every emoji on the reaction wheel", () => {
    for (const emoji of ["🔥", "✅", "👌", "🤌", "🫡", "👀", "💀", "🫶"]) expect(EMOJI_NAMES[emoji], emoji).toBeTruthy();
  });
});
