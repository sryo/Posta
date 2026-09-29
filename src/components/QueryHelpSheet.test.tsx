import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { QueryHelpSheet } from "./QueryHelpSheet";

describe("QueryHelpSheet", () => {
  it("inserts a row's operator and closes", () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    render(() => <QueryHelpSheet onInsert={onInsert} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^from:/ }));
    expect(onInsert).toHaveBeenCalledWith("from:");
    expect(onClose).toHaveBeenCalled();
  });

  it("inserts only the operator of a row whose example value is a placeholder", () => {
    const onInsert = vi.fn();
    render(() => <QueryHelpSheet onInsert={onInsert} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^with:name/ }));
    expect(onInsert).toHaveBeenCalledWith("with:");
    fireEvent.click(screen.getByRole("button", { name: /^newer_than:7d/ }));
    expect(onInsert).toHaveBeenLastCalledWith("newer_than:7d");
  });

  it("lists calendar:week and explains leaving words out", () => {
    render(() => <QueryHelpSheet onInsert={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^calendar:week/ })).toBeInTheDocument();
    expect(screen.getByText("Leave out emails containing word")).toBeInTheDocument();
    expect(screen.getByText("Leave out events containing word")).toBeInTheDocument();
  });
});
