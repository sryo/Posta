import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { PRESETS } from "../app/presets";
import { PresetPicker } from "./PresetPicker";
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

describe("PresetPicker", () => {
  it("asks for a starting layout and says it can change later", () => {
    renderPicker();
    expect(screen.getByRole("dialog", { name: "Pick a starting layout" })).toBeInTheDocument();
    expect(screen.getByText("You can change cards any time")).toBeInTheDocument();
  });

  it("lists each preset's cards and previews every one of them, calendar cards included", () => {
    renderPicker();
    const posta = option("Posta");
    expect(within(posta).getByText("Hot · Meh · Files · Today · Everything else")).toBeInTheDocument();
    expect(posta.querySelectorAll(".preset-card")).toHaveLength(PRESETS.posta.cards.length);
    expect(posta.querySelector(".preset-card.none")).not.toBeNull();
    expect(within(option("Blank")).getByText("No cards")).toBeInTheDocument();
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

  it("picks a preset", () => {
    const props = renderPicker();
    fireEvent.click(option("Classic"));
    expect(props.onPick).toHaveBeenCalledWith("traditional");
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
