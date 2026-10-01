import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { liftRows } from "./rowTravel";
import { EASE_EXIT, EASE_SETTLE } from "./motion";

type Call = { el: Element; frames: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void };
let calls: Call[] = [];
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  calls = [];
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    calls.push({ el: this, frames, options, finish });
    return { finished, cancel: () => {} };
  };
});
afterEach(() => {
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  window.matchMedia = originalMatchMedia;
  document.body.innerHTML = "";
});

const box = (left: number, top: number, width = 300, height = 50) =>
  () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });

// Cards side by side, 320px apart, each a list of 50px rows; `unread` is the
// header's count
function board(cards: Record<string, { rows: string[]; unread?: number }>) {
  const render = (next: Record<string, { rows: string[]; unread?: number }>) => {
    document.body.innerHTML = "";
    Object.entries(next).forEach(([id, { rows, unread }], i) => {
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.id = id;
      card.innerHTML = `<div class="card-header">${unread ? `<span class="card-unread-badge">${unread}</span>` : ""}</div><div class="card-body"></div>`;
      const body = card.querySelector<HTMLElement>(".card-body")!;
      body.getBoundingClientRect = box(i * 320, 100, 300, 600);
      rows.forEach((rowId, r) => {
        const row = document.createElement("div");
        row.className = "thread";
        row.dataset.threadId = rowId;
        row.textContent = rowId;
        Object.defineProperty(row, "offsetHeight", { value: 50 });
        row.getBoundingClientRect = box(i * 320, 100 + r * 50);
        body.append(row);
      });
      document.body.append(card);
    });
  };
  render(cards);
  return { render };
}
const row = (card: string, id: string) => document.querySelector<HTMLElement>(`.card[data-id="${card}"] [data-thread-id="${id}"]`)!;
const traveller = () => document.querySelector<HTMLElement>(".row-traveller");
const settle = () => new Promise(r => setTimeout(r, 0));

describe("liftRows", () => {
  it("carries the row from its place to its place in the card it went to, which makes room for it", async () => {
    const { render } = board({ inbox: { rows: ["a", "s", "g"] }, receipts: { rows: ["p", "f"] } });
    const departure = liftRows("inbox", ["s"])!;
    render({ inbox: { rows: ["a", "g"] }, receipts: { rows: ["s", "p", "f"] } });
    departure.land();

    const clone = traveller()!;
    expect(clone).toHaveTextContent("s");
    expect(clone).toHaveAttribute("aria-hidden", "true");
    expect(clone.style.left).toBe("0px");
    expect(clone.style.top).toBe("150px");
    const flight = calls.find(c => c.el === clone)!;
    expect(flight.options).toMatchObject({ duration: 360, easing: EASE_SETTLE });
    expect(flight.frames[0]).toMatchObject({ transform: "translate(0px, 0px) scale(1)" });
    expect(flight.frames[1]).toMatchObject({ transform: "translate(0px, -3px) scale(1.02)" });
    expect(flight.frames[flight.frames.length - 1]).toMatchObject({ transform: "translate(320px, -50px) scale(1)" });

    // The card it went to opens a gap; the one it left closes its own
    const gap = calls.find(c => c.el === row("receipts", "s"))!;
    expect(gap.options).toMatchObject({ duration: 240, delay: 60 });
    expect(calls.find(c => c.el === row("receipts", "p"))!.options).toMatchObject({ duration: 240, delay: 60 });
    expect(calls.find(c => c.el === row("inbox", "g"))!.options).toMatchObject({ duration: 240, delay: 60 });

    expect(row("receipts", "s").style.visibility).toBe("hidden");
    flight.finish();
    await settle();
    expect(traveller()).toBeNull();
    expect(row("receipts", "s").style.visibility).toBe("");
  });

  it("slides the row aside and folds its gap when no card on the board takes it", () => {
    const { render } = board({ inbox: { rows: ["a", "g", "r"] } });
    const departure = liftRows("inbox", ["g"])!;
    render({ inbox: { rows: ["a", "r"] } });
    departure.land();

    const slide = calls.find(c => c.el === traveller())!;
    expect(slide.frames).toEqual([{ transform: "none", opacity: 1 }, { transform: "translateX(24px)", opacity: 0 }]);
    expect(slide.options).toMatchObject({ duration: 140, easing: EASE_EXIT });
    expect(calls.find(c => c.el === row("inbox", "r"))!.options).toMatchObject({ delay: 140, duration: 200 });
  });

  it("leaves a row that stayed where it was, while a copy goes to the other card", () => {
    const { render } = board({ inbox: { rows: ["a", "s"] }, starred: { rows: ["x"] } });
    const departure = liftRows("inbox", ["s"])!;
    render({ inbox: { rows: ["a", "s"] }, starred: { rows: ["s", "x"] } });
    departure.land();
    expect(calls.find(c => c.el === traveller())!.frames[3]).toMatchObject({ transform: "translate(320px, -50px) scale(1)" });
    expect(calls.find(c => c.el === row("inbox", "s"))).toBeUndefined();
  });

  it("carries a dropped row from where it was let go", () => {
    const { render } = board({ inbox: { rows: ["a", "s"] }, receipts: { rows: ["p"] } });
    const departure = liftRows("inbox", ["s"], { left: 500, top: 400, width: 260, height: 50 })!;
    render({ inbox: { rows: ["a"] }, receipts: { rows: ["s", "p"] } });
    departure.land();
    const clone = traveller()!;
    expect(clone.style.left).toBe("500px");
    expect(clone.style.top).toBe("400px");
    expect(calls.find(c => c.el === clone)!.frames[3]).toMatchObject({ transform: "translate(-180px, -300px) scale(1)" });
  });

  it("carries the row without its controls", () => {
    const { render } = board({ inbox: { rows: ["a", "s"] } });
    row("inbox", "s").innerHTML = 's<div class="thread-checkbox-wrap"><div class="radial-menu"></div></div>';
    const departure = liftRows("inbox", ["s"])!;
    render({ inbox: { rows: ["a"] } });
    departure.land();
    expect(traveller()!.querySelector(".thread-checkbox-wrap")).toBeNull();
  });

  it("does nothing for a row that neither left nor went anywhere", () => {
    const { render } = board({ inbox: { rows: ["a", "s"] } });
    const departure = liftRows("inbox", ["s"])!;
    render({ inbox: { rows: ["a", "s"] } });
    departure.land();
    expect(traveller()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("rolls a card's count to its new number", () => {
    const { render } = board({ inbox: { rows: ["a", "s"], unread: 2 }, receipts: { rows: ["p"], unread: 1 } });
    const departure = liftRows("inbox", ["s"])!;
    render({ inbox: { rows: ["a"], unread: 1 }, receipts: { rows: ["s", "p"], unread: 2 } });
    departure.land();
    const roll = (card: string) => calls.find(c => c.el === document.querySelector(`.card[data-id="${card}"] .card-unread-badge`))!;
    expect(roll("inbox").frames).toEqual([{ transform: "translateY(-60%)", opacity: 0 }, { transform: "none", opacity: 1 }]);
    expect(roll("receipts").frames).toEqual([{ transform: "translateY(60%)", opacity: 0 }, { transform: "none", opacity: 1 }]);
    expect(roll("inbox").options).toMatchObject({ duration: 200 });
  });

  it("fades out in place and in at its new place when motion is reduced", () => {
    window.matchMedia = ((query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" })) as unknown as typeof window.matchMedia;
    const { render } = board({ inbox: { rows: ["a", "s"] }, receipts: { rows: ["p"] } });
    const departure = liftRows("inbox", ["s"])!;
    render({ inbox: { rows: ["a"] }, receipts: { rows: ["s", "p"] } });
    departure.land();
    expect(calls.find(c => c.el === traveller())!.frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(calls.find(c => c.el === row("receipts", "s"))!.frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(calls.every(c => c.options.duration === 150)).toBe(true);
  });

  it("has nothing to carry where the Web Animations API is missing", () => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    board({ inbox: { rows: ["a", "s"] } });
    expect(liftRows("inbox", ["s"])).toBeNull();
  });

  it("has nothing to carry when the row isn't on the board", () => {
    board({ inbox: { rows: ["a"] } });
    expect(liftRows("inbox", ["s"])).toBeNull();
  });
});
