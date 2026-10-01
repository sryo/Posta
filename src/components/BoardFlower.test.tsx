import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { BoardFlower } from "./BoardFlower";

const animate = vi.fn((_frames: Keyframe[], _options?: KeyframeAnimationOptions) => ({ finished: new Promise(() => {}), cancel: () => {} }));
beforeEach(() => {
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
});
afterEach(() => {
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  animate.mockClear();
});

function flowerOnBoard(value: string | null = null) {
  const onPreview = vi.fn();
  const onColor = vi.fn();
  render(() => (
    <div class="deck">
      <BoardFlower
        at={{ x: 400, y: 300 }}
        colors={[{ hue: "green", label: "Green" }, { hue: "blue", label: "Blue" }]}
        value={value}
        onCompose={() => {}}
        onEvent={() => {}}
        onSearch={() => {}}
        onColor={onColor}
        onPreview={onPreview}
        onClose={() => {}}
      />
    </div>
  ));
  fireEvent.click(screen.getByRole("menuitem", { name: "Board color" }));
  const petal = screen.getByRole("menuitemradio", { name: "Green" });
  petal.getBoundingClientRect = () => ({ left: 430, top: 290, width: 22, height: 22, right: 452, bottom: 312, x: 430, y: 290, toJSON: () => ({}) });
  const deck = document.querySelector<HTMLElement>(".deck")!;
  return { deck, petal, onPreview, onColor };
}

describe("BoardFlower colours", () => {
  it("spreads a tried colour across the board from its petal", () => {
    const { deck, petal, onPreview } = flowerOnBoard();
    fireEvent.pointerEnter(petal);
    expect(onPreview).toHaveBeenCalledWith("green");
    const layers = deck.querySelectorAll(".color-spread.board");
    expect(layers).toHaveLength(2);
    expect(layers[1]).toHaveAttribute("data-hue", "green");
    const grow = animate.mock.calls.find(([frames]) => "clipPath" in frames[0])!;
    expect(grow[0][0]).toEqual({ clipPath: "circle(0px at 441px 301px)" });
    expect(grow[1]).toMatchObject({ duration: 460 });
  });

  it("puts the board's colour back at once when the try ends", () => {
    const { deck, petal, onPreview } = flowerOnBoard("blue");
    fireEvent.pointerEnter(petal);
    fireEvent.pointerLeave(petal);
    expect(onPreview).toHaveBeenLastCalledWith(undefined);
    expect(deck.querySelectorAll(".color-spread")).toHaveLength(0);
  });
});
