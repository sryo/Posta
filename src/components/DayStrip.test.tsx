import { describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import { DayStrip } from "./DayStrip";

const busy = [{ left: 10, width: 20, title: "Standup", overlap: false }, { left: 40, width: 10, title: "Review", overlap: true }];

describe("DayStrip", () => {
  it("draws a small strip only to look at: untitled busy blocks, a plain slot, no hour labels", () => {
    const { container } = render(() => <DayStrip size="sm" ticks={[25, 75]} noonAt={50} past={30} nowAt={30} busy={busy} slotBox={{ left: 40, width: 10 }} />);
    const strip = container.querySelector(".day-strip")!;
    expect(strip).toHaveAttribute("aria-hidden", "true");
    expect(strip.querySelectorAll(".day-strip-tick")).toHaveLength(3);
    expect(strip.querySelector(".day-strip-tick.noon")).toHaveStyle({ left: "50%" });
    expect(Array.from(strip.querySelectorAll(".day-strip-busy")).map(b => [b.textContent, b.classList.contains("overlap")])).toEqual([["", false], ["", true]]);
    expect(strip.querySelector(".day-strip-slot")).toHaveStyle({ left: "40%", width: "10%" });
    expect(strip.querySelector(".day-strip-hours")).toBeNull();
  });

  it("draws a large one with titled blocks, hour labels and the caller's own slot", () => {
    const { container } = render(() => (
      <DayStrip
        size="lg"
        ticks={[]}
        busy={busy}
        slotBox={{ left: 60, width: 5 }}
        hours={[{ at: 0, label: "8 AM" }, { at: 100, label: "8 PM" }]}
        slot={(style) => <div class="day-strip-slot" role="slider" style={style()} />}
      />
    ));
    const strip = container.querySelector(".day-strip")!;
    expect(strip).not.toHaveAttribute("aria-hidden");
    expect(strip.querySelector(".day-strip-busy")).toHaveTextContent("Standup");
    expect(strip.querySelector('[role="slider"]')).toHaveStyle({ left: "60%", width: "5%" });
    expect(strip.querySelector(".day-strip-hours")).toHaveTextContent("8 AM8 PM");
  });
});
