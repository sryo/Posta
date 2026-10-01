import { describe, it, expect, vi } from "vitest";
import { dockIconForHue, createDockIconSync } from "./dockIcon";

const TOKENS: Record<string, string> = {
  "--neutral-0": "#ffffff",
  "--neutral-900": "#1e1e1e",
  "--hue-red": "#E53935",
  "--hue-yellow": "#FDD835",
};
const readToken = (name: string) => TOKENS[name] ?? "";

function fills(svg: string) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  return {
    stamp: doc.getElementById("stamp")?.getAttribute("fill"),
    glyph: doc.getElementById("glyph")?.getAttribute("fill"),
  };
}

describe("dock icon for a board colour", () => {
  it("inks the stamp's p. in the board's hue", () => {
    const svg = dockIconForHue("red", readToken)!;
    expect(fills(svg)).toEqual({ stamp: "#ffffff", glyph: "#E53935" });
  });

  it("turns the stamp itself the hue when the p. would be too pale to read on it", () => {
    const svg = dockIconForHue("yellow", readToken)!;
    expect(fills(svg)).toEqual({ stamp: "#FDD835", glyph: "#1e1e1e" });
  });

  it("keeps the bundled icon with no board colour, or a hue the stylesheet doesn't define", () => {
    expect(dockIconForHue(undefined, readToken)).toBeNull();
    expect(dockIconForHue("green", readToken)).toBeNull();
  });
});

describe("dock icon sync", () => {
  const deferred = () => {
    let resolve!: (png: Uint8Array) => void;
    const promise = new Promise<Uint8Array>(r => { resolve = r; });
    return { promise, resolve };
  };

  it("leaves the bundled icon alone until a board colour is picked, and restores it after", async () => {
    const apply = vi.fn(async () => {});
    const sync = createDockIconSync(apply, async () => new Uint8Array([1]));
    await sync(null);
    expect(apply).not.toHaveBeenCalled();
    await sync("<svg/>");
    await sync("<svg/>");
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith(new Uint8Array([1]));
    await sync(null);
    expect(apply).toHaveBeenLastCalledWith(null);
  });

  it("shows the last colour picked when an earlier render finishes later", async () => {
    const apply = vi.fn(async () => {});
    const slow = deferred();
    const render = vi.fn((svg: string) => (svg === "<svg id='a'/>" ? slow.promise : Promise.resolve(new Uint8Array([2]))));
    const sync = createDockIconSync(apply, render);
    const first = sync("<svg id='a'/>");
    await sync("<svg id='b'/>");
    slow.resolve(new Uint8Array([1]));
    await first;
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith(new Uint8Array([2]));
  });
});
