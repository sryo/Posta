import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { AfterArchiveSetting } from "./AfterArchiveSetting";
import { loadAfterArchive } from "../app/threadNavigation";

describe("AfterArchiveSetting", () => {
  beforeEach(() => localStorage.clear());

  it("offers next, previous or the board, and remembers the choice", () => {
    render(() => <AfterArchiveSetting />);
    const select = screen.getByRole("combobox", { name: "After archiving" }) as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(["Open the next thread", "Open the previous thread", "Go back to the board"]);
    expect(select.value).toBe("next");
    fireEvent.change(select, { target: { value: "board" } });
    expect(loadAfterArchive()).toBe("board");
  });

  it("shows the stored choice", () => {
    localStorage.setItem("afterArchive", "previous");
    render(() => <AfterArchiveSetting />);
    expect((screen.getByRole("combobox", { name: "After archiving" }) as HTMLSelectElement).value).toBe("previous");
  });
});
