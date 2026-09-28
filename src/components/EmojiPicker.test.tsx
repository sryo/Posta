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

  it("sends letters typed after clicking a category to the search box, not to page shortcuts", () => {
    const pageShortcut = vi.fn();
    document.addEventListener("keydown", pageShortcut);
    const { container } = render(() => <EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    const tab = container.querySelectorAll<HTMLButtonElement>(".emoji-category-tab")[2];
    tab.focus();
    fireEvent.keyDown(tab, { key: "a" });
    expect(pageShortcut).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(container.querySelector(".emoji-search"));

    // Space still activates the focused button, and shortcuts with modifiers pass
    tab.focus();
    fireEvent.keyDown(tab, { key: " " });
    fireEvent.keyDown(tab, { key: "c", metaKey: true });
    expect(pageShortcut).toHaveBeenCalledTimes(2);

    // WebKit leaves a clicked button unfocused, so focus sits on the body
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "h" });
    expect(pageShortcut).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(container.querySelector(".emoji-search"));
    document.removeEventListener("keydown", pageShortcut);
  });

  it("leaves letters typed in a field outside the picker to that field", () => {
    const reply = document.createElement("textarea");
    document.body.appendChild(reply);
    render(() => <EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    reply.focus();
    fireEvent.keyDown(reply, { key: "h" });
    expect(document.activeElement).toBe(reply);
    reply.remove();
  });

  it("says so when no category matches the search", () => {
    const { container } = render(() => <EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    const input = container.querySelector<HTMLInputElement>(".emoji-search")!;
    fireEvent.input(input, { target: { value: "zzz" } });
    expect(container.querySelectorAll(".emoji-btn")).toHaveLength(0);
    expect(container.querySelector(".emoji-grid-container")?.textContent).toBe("No matching emoji");
  });
});
