import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { RecentContact } from "../app/contacts";
import { querySuggestions } from "../app/querySuggestions";
import { QueryField } from "./QueryField";

const contact = (email: string, name?: string): RecentContact => ({ email, name, frequency: 2, lastContacted: 0, fromGoogle: false });
const PLACEHOLDER = "e.g. from:boss is:unread newer_than:7d";

function renderField(initial: string, opts: { contacts?: RecentContact[]; labels?: string[]; onActive?: (insert: (text: string) => void) => void } = {}) {
  const [query, setQuery] = createSignal(initial);
  const contacts = opts.contacts ?? [];
  const labels = opts.labels ?? [];
  render(() => (
    <QueryField
      query={query()}
      setQuery={setQuery}
      suggest={(q, caret) => querySuggestions(q, contacts, labels, caret)}
      contacts={contacts}
      labelNames={labels}
      onSave={vi.fn()}
      onCancel={vi.fn()}
      onActive={opts.onActive}
    />
  ));
  const input = screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement;
  return { query, input };
}

describe("QueryField chips", () => {
  it("shows recognised operators as chips and plain words as text while not editing", () => {
    renderField("from:ana@x.com is:unread invoice");
    const chips = screen.getAllByRole("button", { name: /^Change / });
    expect(chips.map(c => c.textContent)).toEqual(["from:ana@x.com", "is:unread"]);
    expect(screen.getByText("invoice")).toHaveClass("query-word");
  });

  it("shows a contact's name on an address chip", () => {
    renderField("from:ana@x.com", { contacts: [contact("ana@x.com", "Ana Pérez")] });
    expect(screen.getByRole("button", { name: "Change from:ana@x.com" })).toHaveTextContent("from:Ana Pérez");
  });

  it("removes a chip's operator from the query", () => {
    const { query } = renderField("is:unread from:ana@x.com invoice");
    fireEvent.click(screen.getByRole("button", { name: "Remove from:ana@x.com" }));
    expect(query()).toBe("is:unread invoice");
  });

  it("changes a chip's value from its picker", () => {
    const { query } = renderField("is:unread newer_than:7d");
    fireEvent.click(screen.getByRole("button", { name: "Change newer_than:7d" }));
    const picker = screen.getByRole("dialog", { name: "newer_than" });
    fireEvent.click(within(picker).getByRole("button", { name: /1 month/ }));
    expect(query()).toBe("is:unread newer_than:1m");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes a chip's picker on Escape without letting the Escape reach the rest of the app", () => {
    const onKeyDown = vi.fn();
    document.addEventListener("keydown", onKeyDown);
    renderField("is:unread");
    fireEvent.click(screen.getByRole("button", { name: "Change is:unread" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    document.removeEventListener("keydown", onKeyDown);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it("picks a contact for an address chip, filtering by what is typed", () => {
    const { query } = renderField("from:ana@x.com", { contacts: [contact("ana@x.com", "Ana"), contact("bo@x.com", "Bo")] });
    fireEvent.click(screen.getByRole("button", { name: "Change from:ana@x.com" }));
    const picker = screen.getByRole("dialog", { name: "from" });
    fireEvent.input(within(picker).getByRole("textbox"), { target: { value: "bo" } });
    expect(within(picker).queryByRole("button", { name: /Ana/ })).not.toBeInTheDocument();
    fireEvent.click(within(picker).getByRole("button", { name: /Bo/ }));
    expect(query()).toBe("from:bo@x.com");
  });

  it("picks a label for a label chip", () => {
    const { query } = renderField("label:travel", { labels: ["Travel", "Work/Projects"] });
    fireEvent.click(screen.getByRole("button", { name: "Change label:travel" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "label" })).getByRole("button", { name: "Work/Projects" }));
    expect(query()).toBe("label:work-projects");
  });

  it("edits a chip as text, putting the caret after it", () => {
    const { input } = renderField("is:unread newer_than:7d invoice");
    fireEvent.click(screen.getByRole("button", { name: "Change newer_than:7d" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Edit as text" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(input);
    expect(input).toHaveValue("newer_than:7d");
    expect(input.selectionStart).toBe("newer_than:7d".length);
    expect(screen.getByRole("button", { name: "Change is:unread" })).toBeInTheDocument();
    expect(screen.getByText("invoice")).toHaveClass("query-word");
  });

  it("moves focus into a chip's picker and back to the chip when it closes", () => {
    renderField("is:unread");
    const chip = screen.getByRole("button", { name: "Change is:unread" });
    chip.focus();
    fireEvent.click(chip);
    const picker = screen.getByRole("dialog", { name: "is" });
    expect(picker.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toHaveTextContent("Unread messages");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Change is:unread" }));
  });

});

describe("QueryField while typing", () => {
  it("keeps the finished words as chips around the text box", () => {
    const { input } = renderField("is:unread invoice");
    fireEvent.focus(input);
    expect(screen.getByRole("button", { name: "Change is:unread" })).toBeInTheDocument();
    expect(screen.getByText("invoice")).toHaveClass("query-word");
    expect(input).toHaveValue("");
    fireEvent.blur(input);
    expect(screen.getByRole("button", { name: "Change is:unread" })).toBeInTheDocument();
  });

  it("turns a typed operator into a chip once a space follows it", () => {
    const { input, query } = renderField("");
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "from:ana@x.com" } });
    expect(screen.queryByRole("button", { name: "Change from:ana@x.com" })).not.toBeInTheDocument();
    fireEvent.input(input, { target: { value: "from:ana@x.com " } });
    expect(screen.getByRole("button", { name: "Change from:ana@x.com" })).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(query()).toBe("from:ana@x.com");
  });

  it("leaves text an input method is still composing in the text box", () => {
    const { input, query } = renderField("");
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "subject:日本 " }, isComposing: true });
    expect(input).toHaveValue("subject:日本 ");
    expect(screen.queryByRole("button", { name: "Change subject:日本" })).not.toBeInTheDocument();
    expect(query()).toBe("subject:日本");
  });

  it("changes a chip from its picker while typing, keeping the typed text and the focus", () => {
    const { input, query } = renderField("is:unread newer_than:7d");
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "invo" } });
    const chip = screen.getByRole("button", { name: "Change newer_than:7d" });
    expect(fireEvent.mouseDown(chip)).toBe(false);
    fireEvent.click(chip);
    fireEvent.blur(input);
    const picker = screen.getByRole("dialog", { name: "newer_than" });
    fireEvent.click(within(picker).getByRole("button", { name: /1 month/ }));
    expect(query()).toBe("is:unread newer_than:1m invo");
    expect(input).toHaveValue("invo");
    expect(document.activeElement).toBe(input);
  });

  it("removes a chip while typing", () => {
    const { input, query } = renderField("is:unread invoice");
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "from:a" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove is:unread" }));
    expect(query()).toBe("invoice from:a");
    expect(input).toHaveValue("from:a");
  });

  it("takes the word before the text box back into it on Backspace at its start", () => {
    const { input, query } = renderField("is:unread from:ana@x.com");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(input).toHaveValue("from:ana@x.com");
    expect(input.selectionStart).toBe("from:ana@x.com".length);
    expect(screen.queryByRole("button", { name: "Change from:ana@x.com" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change is:unread" })).toBeInTheDocument();
    expect(query()).toBe("is:unread from:ana@x.com");
  });

  it("moves the text box between chips with the arrow keys", () => {
    const { input, query } = renderField("is:unread invoice");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    fireEvent.input(input, { target: { value: "has:attachment" } });
    expect(query()).toBe("has:attachment is:unread invoice");
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(input).toHaveValue("");
    expect(query()).toBe("has:attachment is:unread invoice");
    expect(screen.getByRole("button", { name: "Change has:attachment" })).toBeInTheDocument();
  });

  it("keeps a chip focused when Tab moves to it from the text box", () => {
    const { input } = renderField("is:unread from:ana@x.com");
    input.focus();
    fireEvent.input(input, { target: { value: "invo" } });
    const chip = screen.getByRole("button", { name: "Change from:ana@x.com" });
    chip.focus();
    expect(chip.isConnected).toBe(true);
    expect(document.activeElement).toBe(chip);
    expect(input).toHaveValue("invo");

    fireEvent.click(chip);
    const picker = screen.getByRole("dialog", { name: "from" });
    expect(picker).toBeInTheDocument();
  });

  it("stops editing once focus leaves the field from one of its chips", () => {
    const { input } = renderField("is:unread invoice");
    const outside = document.createElement("button");
    document.body.append(outside);
    input.focus();
    screen.getByRole("button", { name: "Change is:unread" }).focus();
    outside.focus();
    expect(input).toHaveValue("is:unread invoice");
    expect(input.closest(".query-field")).not.toHaveClass("editing");
    outside.remove();
  });

  it("edits a plain word as text when it is clicked", () => {
    const { input } = renderField("is:unread invoice");
    fireEvent.mouseDown(screen.getByText("invoice"));
    expect(document.activeElement).toBe(input);
    expect(input).toHaveValue("invoice");
    expect(screen.getByRole("button", { name: "Change is:unread" })).toBeInTheDocument();
  });
});

describe("QueryField autocomplete", () => {
  it("completes the word at the caret, turning it into a chip", () => {
    const { input, query } = renderField("");
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "is:unr" } });
    const item = screen.getByText("is:unread");
    expect(item.closest(".query-autocomplete")).not.toBeNull();
    fireEvent.mouseDown(item);
    expect(query()).toBe("is:unread");
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: "Change is:unread" })).toBeInTheDocument();
  });

  it("completes a plain word clicked to edit it, keeping its place", () => {
    const { input, query } = renderField("unrea invoice");
    fireEvent.mouseDown(screen.getByText("unrea"));
    expect(input).toHaveValue("unrea");
    fireEvent.mouseDown(screen.getByText("is:unread"));
    expect(query()).toBe("is:unread invoice");
  });

  it("turns every finished word of a paste into chips", () => {
    const { input, query } = renderField("");
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "from:ana@x.com newer_than:7d invo" } });
    expect(screen.getByRole("button", { name: "Change from:ana@x.com" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change newer_than:7d" })).toBeInTheDocument();
    expect(input).toHaveValue("invo");
    expect(query()).toBe("from:ana@x.com newer_than:7d invo");
  });

  it("completes only the text being typed, not the chips after it", () => {
    const { input, query } = renderField("invoice");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    fireEvent.input(input, { target: { value: "is:unr" } });
    fireEvent.mouseDown(screen.getByText("is:unread"));
    expect(query()).toBe("is:unread invoice");
  });

  it("offers calendar operators", () => {
    const { input } = renderField("");
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "calendar:t" } });
    expect(screen.getByText("calendar:today")).toBeInTheDocument();
  });
});

describe("QueryField explanation", () => {
  it("explains the parsed query under the field", () => {
    renderField("calendar:7d with:Ana");
    expect(screen.getByText("Events in the next 7 days · with Ana")).toBeInTheDocument();
  });

  it("explains nothing it can't read in full", () => {
    renderField("from:a OR from:b");
    expect(document.querySelector(".query-explain")).toBeNull();
  });
});

describe("QueryField insertion", () => {
  it("hands out its insert as soon as it appears, adding to the end before the field is focused", () => {
    let insert: ((text: string) => void) | undefined;
    const { query } = renderField("is:unread", { onActive: fn => { insert = fn; } });
    insert!("has:attachment");
    expect(query()).toBe("is:unread has:attachment");
  });

  it("hands out an insert that puts an operator at the caret", () => {
    let insert: ((text: string) => void) | undefined;
    const { input, query } = renderField("is:unread", { onActive: fn => { insert = fn; } });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    insert!("from:");
    expect(query()).toBe("from: is:unread");
    expect(document.activeElement).toBe(input);
  });
});
