import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { EmojiPicker } from "./EmojiPicker";

const emojiTexts = (root: Element) =>
  Array.from(root.querySelectorAll(".emoji-btn")).map((b) => b.textContent);

const duplicates = (list: (string | null)[]) =>
  list.filter((e, i) => list.indexOf(e) !== i);

describe("EmojiPicker", () => {
  it("lists every emoji once per category", () => {
    const { container } = render(() => <EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    const tabs = container.querySelectorAll(".emoji-category-tab");
    expect(tabs.length).toBeGreaterThan(0);
    for (const tab of Array.from(tabs)) {
      fireEvent.click(tab);
      const sections = container.querySelectorAll(".emoji-section");
      const category = sections[sections.length - 1];
      expect(duplicates(emojiTexts(category)), tab.getAttribute("title")!).toEqual([]);
    }
  });

  it("does not repeat an emoji that appears in several matching categories", () => {
    const { container } = render(() => <EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    const input = container.querySelector<HTMLInputElement>(".emoji-search")!;
    fireEvent.input(input, { target: { value: "n" } });
    const results = emojiTexts(container);
    expect(results.length).toBeGreaterThan(0);
    expect(duplicates(results)).toEqual([]);
  });

  it("treats a whitespace-only query as no query instead of showing an empty picker", () => {
    const { container } = render(() => <EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    const input = container.querySelector<HTMLInputElement>(".emoji-search")!;
    fireEvent.input(input, { target: { value: "  " } });
    expect(container.querySelectorAll(".emoji-btn").length).toBeGreaterThan(0);
    expect(container.querySelector(".emoji-categories-tabs")).not.toBeNull();
  });
});
