import { describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import { CardPill } from "./CardPill";

describe("CardPill", () => {
  it("tints a coloured card's pill through the stylesheet, which keeps its text readable", () => {
    const { container } = render(() => <CardPill color="purple">Newsletters · 3 of 5</CardPill>);
    const pill = container.querySelector<HTMLElement>(".thread-bar-card")!;
    expect(pill).toHaveClass("tinted");
    expect(pill).toHaveAttribute("data-hue", "purple");
    expect(pill.getAttribute("style")).toBeNull();
    expect(pill).toHaveTextContent("Newsletters · 3 of 5");
  });

  it("leaves a colourless card's pill plain", () => {
    const { container } = render(() => <CardPill color={null}>Inbox</CardPill>);
    const pill = container.querySelector<HTMLElement>(".thread-bar-card")!;
    expect(pill).not.toHaveClass("tinted");
    expect(pill).not.toHaveAttribute("data-hue");
    expect(pill.getAttribute("style")).toBeNull();
  });
});
