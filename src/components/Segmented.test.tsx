import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { Segmented } from "./Segmented";

const OPTIONS = [
  { value: "date", label: "Date" },
  { value: "sender", label: "Sender" },
] as const;

describe("Segmented", () => {
  it("marks the chosen segment pressed and reports a new choice", () => {
    const onChange = vi.fn();
    render(() => <Segmented label="Group by" options={OPTIONS} value="date" onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Group by" })).toHaveAttribute("data-look", "raised");
    expect(screen.getByRole("button", { name: "Date" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Sender" }));
    expect(onChange).toHaveBeenCalledWith("sender");
  });

  it("keeps a segment's click from reaching the row or card around it", () => {
    const outer = vi.fn();
    render(() => (
      <div onClick={outer}>
        <Segmented label="Group by" options={OPTIONS} value="date" onChange={vi.fn()} />
      </div>
    ));
    fireEvent.click(screen.getByRole("button", { name: "Sender" }));
    expect(outer).not.toHaveBeenCalled();
  });

  it("checks the chosen segment only in the divided look, and can leave it be when pressed again", () => {
    const onChange = vi.fn();
    render(() => <Segmented label="Answer" look="divided" keepChosen options={OPTIONS} value="date" onChange={onChange} />);
    const date = screen.getByRole("button", { name: "Date" });
    expect(date.querySelector(".segment-check")).not.toBeNull();
    fireEvent.click(date);
    expect(onChange).not.toHaveBeenCalled();
  });
});
