import { describe, expect, it } from "vitest";
import { linkPaste, pasteNote, tidyRecipients } from "./tidyPaste";

const SHEET = 'Ana Ruiz <ana.ruiz@estudio.co>; "Bruno Sosa" bruno@sosa.dev\ncarla.m@gmail.com, Pablo (no email yet)\nana.ruiz@estudio.co';

describe("tidyRecipients", () => {
  it("turns a messy list into recipients, merging repeats and leaving what has no address", () => {
    const tidy = tidyRecipients("", SHEET);
    expect(tidy).toEqual({
      value: '"Ana Ruiz" <ana.ruiz@estudio.co>, "Bruno Sosa" <bruno@sosa.dev>, carla.m@gmail.com, Pablo',
      added: 3,
      already: [],
      merged: [],
      unresolved: ["Pablo"],
    });
  });

  it("merges anyone already there and keeps what was there first", () => {
    const tidy = tidyRecipients('"Ana Ruiz" <ana.ruiz@estudio.co>, zoe@x.com', SHEET)!;
    expect(tidy.value).toBe('"Ana Ruiz" <ana.ruiz@estudio.co>, zoe@x.com, "Bruno Sosa" <bruno@sosa.dev>, carla.m@gmail.com, Pablo');
    expect(tidy.added).toBe(2);
    expect(tidy.already).toEqual(["Ana"]);
    expect(tidy.merged).toEqual(["ana.ruiz@estudio.co"]);
  });

  it("names a bare address from the contacts", () => {
    const tidy = tidyRecipients("", "carla.m@gmail.com\nbo@x.com", email => (email === "carla.m@gmail.com" ? "Carla Méndez" : undefined))!;
    expect(tidy.value).toBe('"Carla Méndez" <carla.m@gmail.com>, bo@x.com');
  });

  it("reads a spreadsheet row of name and address", () => {
    expect(tidyRecipients("", "Ana Ruiz\tana@x.co\nBen Ortiz\tben@x.co")!.value).toBe('"Ana Ruiz" <ana@x.co>, "Ben Ortiz" <ben@x.co>');
  });

  it("leaves a single address, or text with no address, to the ordinary paste", () => {
    expect(tidyRecipients("", "ana@x.co")).toBeNull();
    expect(tidyRecipients("", " ana@x.co\n")).toBeNull();
    expect(tidyRecipients("", "Pablo, Carla")).toBeNull();
  });
});

describe("pasteNote", () => {
  it("says exactly what the paste did", () => {
    expect(pasteNote({ added: 2, already: ["Ana"], unresolved: ["Pablo"] })).toBe("Added 2 · Ana was already here · “Pablo” has no address, left for you");
    expect(pasteNote({ added: 1, already: ["Ana", "Ben"], unresolved: [] })).toBe("Added 1 · Ana and Ben were already here");
    expect(pasteNote({ added: 0, already: ["Ana", "Ben", "Cleo"], unresolved: ["Pablo", "Rita"] }))
      .toBe("3 were already here · 2 have no address, left for you");
  });
});

describe("linkPaste", () => {
  const text = "Hi all, the deck is ready for comments.";
  const start = text.indexOf("the deck");
  const end = start + "the deck".length;

  it("links selected words to a pasted URL, and says so", () => {
    expect(linkPaste(text, start, end, "https://docs.google.com/presentation/d/1xQ4review")).toEqual({
      text: "Hi all, the deck (https://docs.google.com/presentation/d/1xQ4review) is ready for comments.",
      caret: end + " (https://docs.google.com/presentation/d/1xQ4review)".length,
      note: "Linked “the deck” to docs.google.com",
    });
  });

  it("leaves other pastes alone", () => {
    expect(linkPaste(text, start, start, "https://docs.google.com/x")).toBeNull();
    expect(linkPaste(text, start, end, "not a link")).toBeNull();
    expect(linkPaste(text, start, end, "https://a.com and more")).toBeNull();
    const url = "https://old.com/x";
    expect(linkPaste(`see ${url}`, 4, 4 + url.length, "https://new.com/y")).toBeNull();
  });
});
