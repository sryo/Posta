import { describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import { SortingFrame } from "./SortingFrame";

const slots = (frame: Element) => [...frame.querySelectorAll(".sorting-slot")];

function renderFrame(props: Parameters<typeof SortingFrame>[0]) {
  const { container } = render(() => <SortingFrame {...props} />);
  return container.querySelector(".sorting-frame")!;
}

describe("SortingFrame", () => {
  it("draws one slot per card, labelled with its name and inked in its colour", () => {
    const frame = renderFrame({ cards: [{ name: "Hot", color: "blue" }, { name: "Today" }] });
    expect(slots(frame).map(s => s.querySelector(".sorting-label")?.textContent)).toEqual(["Hot", "Today"]);
    expect(slots(frame).map(s => s.getAttribute("data-hue"))).toEqual(["blue", null]);
  });

  it("is an illustration screen readers skip, since its owner names the cards", () => {
    const frame = renderFrame({ cards: [{ name: "Hot", color: "blue" }] });
    expect(frame).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps three letters in every slot, ready to drop in", () => {
    const frame = renderFrame({ cards: [{ name: "Hot" }, { name: "Ping" }] });
    for (const slot of slots(frame)) expect(slot.querySelectorAll(".sorting-letter")).toHaveLength(3);
  });

  it("draws an unlabelled slot with nothing to drop into for a layout without cards", () => {
    const frame = renderFrame({ cards: [] });
    expect(slots(frame)).toHaveLength(1);
    expect(slots(frame)[0]).toHaveClass("bare");
    expect(slots(frame)[0].querySelector(".sorting-label")?.textContent?.trim()).toBe("");
    expect(frame.querySelector(".sorting-letter")).toBeNull();
  });

  it("lights and fills the slots it is told to", () => {
    const frame = renderFrame({
      cards: [{ name: "Inbox" }, { name: "Unread" }, { name: "Starred" }],
      lit: i => i === 1,
      filled: i => i === 2,
    });
    expect(slots(frame).map(s => s.classList.contains("lit"))).toEqual([false, true, false]);
    expect(slots(frame).map(s => s.classList.contains("filled"))).toEqual([false, false, true]);
  });
});
