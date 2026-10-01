import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";

let SoundSettings: typeof import("./SoundSettings").SoundSettings;
let sounds: typeof import("../app/sounds");

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  vi.stubGlobal("AudioContext", undefined);
  ({ SoundSettings } = await import("./SoundSettings"));
  sounds = await import("../app/sounds");
});

const mailCards = [{ id: "card-a", name: "Inbox" }, { id: "card-b", name: "Clients" }];

describe("SoundSettings", () => {
  it("offers sounds off, saying when the note plays", () => {
    render(() => <SoundSettings cards={mailCards} />);
    const group = screen.getByRole("group", { name: "Sounds" });
    expect(within(group).getByRole("switch", { name: "Sounds" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("A soft note when a message has actually left, after Undo is no longer possible.")).toBeInTheDocument();
    expect(within(group).queryByRole("switch", { name: /New mail/ })).toBeNull();
  });

  it("turns sounds on, then offers a lower note for new mail in each card", () => {
    render(() => <SoundSettings cards={mailCards} />);
    fireEvent.click(screen.getByRole("switch", { name: "Sounds" }));
    expect(sounds.soundsEnabled()).toBe(true);
    expect(screen.getByRole("switch", { name: "Sounds" })).toHaveAttribute("aria-checked", "true");

    const clients = screen.getByRole("switch", { name: "New mail in Clients" });
    expect(clients).toHaveAttribute("aria-checked", "false");
    fireEvent.click(clients);
    expect(clients).toHaveAttribute("aria-checked", "true");
    expect([...sounds.arrivalCards()]).toEqual(["card-b"]);
  });
});
