import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { PRESETS } from "../app/presets";
import { PresetPicker } from "./PresetPicker";
import { SORT_MS } from "./SortingFrame";
import { layerCount } from "../app/layers";

function renderPicker(extra: Partial<Parameters<typeof PresetPicker>[0]> = {}) {
  const props = {
    presets: PRESETS,
    onPick: vi.fn(),
    onDismiss: vi.fn(),
    ...extra,
  };
  render(() => <PresetPicker {...props} />);
  return props;
}

const option = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label}`) });
const slots = (el: HTMLElement) => [...el.querySelectorAll(".sorting-slot")];

afterEach(() => {
  vi.useRealTimers();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("PresetPicker", () => {
  it("asks for a starting layout and says it can change later", () => {
    renderPicker();
    expect(screen.getByRole("dialog", { name: "Pick a starting layout" })).toBeInTheDocument();
    expect(screen.getByText("You can change cards any time")).toBeInTheDocument();
  });

  it("names each preset's cards to screen readers, and says when it has none", () => {
    renderPicker();
    expect(option("Posta")).toHaveAccessibleName(/7 cards: Hot, Ping, Waiting, Meh, Stash, Today, Everything else$/);
    expect(option("Classic")).toHaveAccessibleName(/4 cards: Inbox, Starred, Drafts, Sent$/);
    expect(option("Blank")).toHaveAccessibleName(/No cards$/);
  });

  it("draws each preset as a sorting frame, a slot per card labelled with its name in its colour", () => {
    renderPicker();
    const posta = slots(option("Posta"));
    expect(posta.map(s => s.querySelector(".sorting-label")?.textContent)).toEqual(PRESETS.posta.cards.map(c => c.name));
    expect(posta.map(s => s.getAttribute("data-hue"))).toEqual(["blue", "orange", "yellow", "red", "purple", null, null]);
    expect(slots(option("Blank"))).toHaveLength(1);
    expect(slots(option("Blank"))[0]).toHaveClass("bare");
  });

  it("calls the familiar setup Classic", () => {
    renderPicker();
    expect(option("Classic")).toBeInTheDocument();
    expect(screen.queryByText("Traditional")).not.toBeInTheDocument();
  });

  it("keeps the recommended badge inside the preset's label", () => {
    renderPicker();
    const badge = screen.getByText("Recommended");
    expect(badge.closest(".preset-label")).toHaveTextContent(/^Posta/);
  });

  it("lists the presets in order, the recommended one first", () => {
    renderPicker();
    const options = within(screen.getByRole("dialog")).getAllByRole("button").slice(0, -1);
    expect(options.map(o => o.querySelector(".preset-label")?.firstChild?.textContent)).toEqual(["Posta", "Classic", "Power User", "Blank"]);
  });

  it("drops letters into the chosen frame's slots, then picks that preset", async () => {
    const props = renderPicker();
    vi.useFakeTimers();
    fireEvent.click(option("Classic"));
    const classic = slots(option("Classic"));
    expect(classic.every(s => s.classList.contains("filled") && s.classList.contains("lit"))).toBe(true);
    expect(slots(option("Posta")).some(s => s.classList.contains("filled"))).toBe(false);
    expect(props.onPick).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SORT_MS);
    expect(props.onPick).toHaveBeenCalledWith("traditional");
  });

  it("picks one preset per drop", async () => {
    const props = renderPicker();
    vi.useFakeTimers();
    fireEvent.click(option("Classic"));
    fireEvent.click(option("Posta"));
    await vi.advanceTimersByTimeAsync(SORT_MS);
    expect(props.onPick).toHaveBeenCalledTimes(1);
    expect(props.onPick).toHaveBeenCalledWith("traditional");
  });

  it("empties the slots again when the layout couldn't be replaced, so another can be tried", async () => {
    let fail!: () => void;
    const props = renderPicker({ onPick: vi.fn(() => new Promise<void>(resolve => { fail = resolve; })) });
    vi.useFakeTimers();
    fireEvent.click(option("Classic"));
    await vi.advanceTimersByTimeAsync(SORT_MS);
    expect(slots(option("Classic"))[0]).toHaveClass("filled");

    fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(slots(option("Classic")).some(s => s.classList.contains("filled"))).toBe(false);
    fireEvent.click(option("Posta"));
    await vi.advanceTimersByTimeAsync(SORT_MS);
    expect(props.onPick).toHaveBeenLastCalledWith("posta");
  });

  it("picks at once, with the letters already in, when motion is reduced", () => {
    window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("reduce") })) as unknown as typeof window.matchMedia;
    const props = renderPicker();
    fireEvent.click(option("Power User"));
    expect(props.onPick).toHaveBeenCalledWith("power");
  });

  it("picks nothing when dismissed while the letters drop", async () => {
    const props = renderPicker();
    vi.useFakeTimers();
    fireEvent.click(option("Classic"));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await vi.advanceTimersByTimeAsync(SORT_MS);
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
    expect(props.onPick).not.toHaveBeenCalled();
  });

  it("closes on Escape without picking anything", () => {
    const props = renderPicker();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
    expect(props.onPick).not.toHaveBeenCalled();
  });

  it("starts with the recommended preset focused", () => {
    renderPicker();
    expect(document.activeElement).toBe(option("Posta"));
  });

  it("keeps Tab inside the picker", () => {
    renderPicker();
    const notNow = screen.getByRole("button", { name: "Not now" });
    notNow.focus();
    fireEvent.keyDown(notNow, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getAllByRole("button")[0]);
  });

  it("closes through the shared Escape layers", () => {
    renderPicker();
    expect(layerCount()).toBe(1);
  });
});
