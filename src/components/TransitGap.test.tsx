import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { TransitGap } from "./TransitGap";
import { transitGap } from "../app/transit";

const transit = transitGap(new Date(2025, 7, 1), new Date(2026, 9, 1))!;

// Stands in for the browser's observer: `see` scrolls an element into view
function stubObserver() {
  const observers: { callback: IntersectionObserverCallback; watched: Set<Element> }[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    watched = new Set<Element>();
    constructor(callback: IntersectionObserverCallback) { observers.push({ callback, watched: this.watched }); }
    observe(el: Element) { this.watched.add(el); }
    unobserve(el: Element) { this.watched.delete(el); }
    disconnect() { this.watched.clear(); }
  });
  const see = (el: Element) => {
    for (const o of observers) {
      if (o.watched.has(el)) o.callback([{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  };
  return { observers, see };
}

afterEach(() => vi.unstubAllGlobals());

describe("TransitGap", () => {
  it("stamps how long the letter took, named for assistive tech", () => {
    render(() => <TransitGap transit={transit} hue="purple" />);
    const note = screen.getByRole("note", { name: "14 months between letters." });
    expect(note).toHaveAttribute("data-hue", "purple");
    const stamp = note.querySelector("svg.postmark.transit-stamp")!;
    expect(stamp).toHaveAttribute("aria-hidden", "true");
    expect(stamp.querySelector("g")).toHaveAttribute("filter", "url(#postmark-ink)");
    expect(stamp.querySelector(".postmark-text")?.textContent).toBe("IN TRANSIT14 MONTHSAUG 2025 – OCT 2026");
    const lines = note.querySelectorAll(".transit-line");
    expect(lines).toHaveLength(2);
    expect(note.firstElementChild).toBe(lines[0]);
    expect(note.lastElementChild).toBe(lines[1]);
  });

  it("inks a colourless card's stamp in the default ink", () => {
    render(() => <TransitGap transit={transit} hue={null} />);
    expect(screen.getByRole("note")).not.toHaveAttribute("data-hue");
  });

  it("lands only the first time it scrolls into view, all stamps watched by one observer", () => {
    const { observers, see } = stubObserver();
    const { container } = render(() => <><TransitGap transit={transit} /><TransitGap transit={transit} /></>);
    const [first, second] = container.querySelectorAll("svg.transit-stamp");
    expect(first).not.toHaveClass("lands");
    see(first);
    expect(first).toHaveClass("lands");
    expect(second).not.toHaveClass("lands");
    expect(observers.length).toBeLessThanOrEqual(1);
    expect(observers[0]?.watched.has(first)).toBe(false);
    expect(observers[0]?.watched.has(second)).toBe(true);
  });

  it("stops watching a stamp that leaves before it is seen", () => {
    const { observers } = stubObserver();
    const { container, unmount } = render(() => <TransitGap transit={transit} />);
    const stamp = container.querySelector("svg.transit-stamp")!;
    expect(observers[0]?.watched.has(stamp)).toBe(true);
    unmount();
    expect(observers[0]?.watched.has(stamp)).toBe(false);
  });

  it("stays still where nothing can watch it scroll", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = render(() => <TransitGap transit={transit} />);
    expect(container.querySelector("svg.transit-stamp")).not.toHaveClass("lands");
  });
});
