import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { AloneNotice } from "./AloneNotice";

describe("AloneNotice", () => {
  it("tells a guest everyone else declined, with nothing to do about it", () => {
    render(() => <AloneNotice alone={{ role: "guest", guests: 2 }} title="Standup" />);
    expect(screen.getByText("Everyone else declined").closest(".calendar-event-alone")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the organizer to reschedule or cancel, without opening the row", () => {
    const onReschedule = vi.fn();
    const onCancel = vi.fn();
    const onRow = vi.fn();
    render(() => (
      <div onClick={onRow}>
        <AloneNotice alone={{ role: "organizer", guests: 3 }} title="Pricing page review" onReschedule={onReschedule} onCancel={onCancel} />
      </div>
    ));
    expect(screen.getByText("All 3 guests declined")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reschedule Pricing page review" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel Pricing page review" }));
    expect(onReschedule).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onRow).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel Pricing page review" })).toHaveTextContent("Cancel event");
  });

  it("keeps Enter and Space on its buttons from reaching the row", () => {
    const onRowKey = vi.fn();
    render(() => (
      <div onKeyDown={onRowKey}>
        <AloneNotice alone={{ role: "organizer", guests: 1 }} title="1:1" onReschedule={() => {}} onCancel={() => {}} />
      </div>
    ));
    fireEvent.keyDown(screen.getByRole("button", { name: "Reschedule 1:1" }), { key: "Enter" });
    expect(onRowKey).not.toHaveBeenCalled();
  });
});
