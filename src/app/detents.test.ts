import { describe, expect, it, vi } from "vitest";
import { createDetents } from "./detents";

function setup() {
  let now = 0;
  const perform = vi.fn((_kind: "alignment" | "levelChange") => {});
  const detents = createDetents(perform, () => now);
  return { perform, detents, wait: (ms: number) => { now += ms; } };
}

describe("createDetents", () => {
  it("ticks lightly each time the dragged card passes into another slot", () => {
    const { perform, detents, wait } = setup();
    detents.start("inbox");
    detents.over("inbox");
    expect(perform).not.toHaveBeenCalled();
    wait(100);
    detents.over("clients");
    wait(100);
    detents.over("clients");
    wait(100);
    detents.over(null);
    wait(100);
    detents.over("inbox");
    expect(perform.mock.calls).toEqual([["alignment"], ["alignment"]]);
  });

  it("ticks at most once every 40 ms", () => {
    const { perform, detents, wait } = setup();
    detents.start("inbox");
    detents.over("clients");
    wait(20);
    detents.over("today");
    wait(20);
    detents.over("receipts");
    expect(perform).toHaveBeenCalledTimes(2);
  });

  it("lands firmly only when the drop changed the order", () => {
    const { perform, detents } = setup();
    detents.start("inbox");
    detents.end(false);
    expect(perform).not.toHaveBeenCalled();
    detents.start("inbox");
    detents.end(true);
    expect(perform).toHaveBeenCalledExactlyOnceWith("levelChange");
  });

  it("stays still between drags", () => {
    const { perform, detents } = setup();
    detents.over("clients");
    detents.end(true);
    expect(perform).not.toHaveBeenCalled();
  });
});
