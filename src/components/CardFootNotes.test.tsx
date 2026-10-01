import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { CardFootNotes } from "./CardFootNotes";

const edesur = { email: "facturas@edesur.com.ar", sender: "Edesur <facturas@edesur.com.ar>", usualDay: 4, text: "Edesur usually writes by the 4th. Nothing yet this month.", query: "from:facturas@edesur.com.ar newer_than:40d" };

describe("CardFootNotes", () => {
  it("states each overdue sender in a line, with Search and a way to hide it", () => {
    const onSearch = vi.fn();
    const onDismiss = vi.fn();
    render(() => <CardFootNotes notices={[edesur]} onSearch={onSearch} onDismiss={onDismiss} />);
    expect(screen.getByText("Edesur usually writes by the 4th. Nothing yet this month.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search for Edesur's mail" }));
    expect(onSearch).toHaveBeenCalledWith("from:facturas@edesur.com.ar newer_than:40d");
    fireEvent.click(screen.getByRole("button", { name: "Hide Edesur until next month" }));
    expect(onDismiss).toHaveBeenCalledWith("facturas@edesur.com.ar");
  });

  it("leaves no trace when there's nothing to say", () => {
    const { container } = render(() => <CardFootNotes notices={[]} onSearch={() => {}} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
