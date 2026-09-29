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

  it("switches to the raw text while the field has focus", () => {
    const { input } = renderField("is:unread");
    fireEvent.focus(input);
    expect(screen.queryByRole("button", { name: "Change is:unread" })).not.toBeInTheDocument();
    expect(input).toHaveValue("is:unread");
    fireEvent.blur(input);
    expect(screen.getByRole("button", { name: "Change is:unread" })).toBeInTheDocument();
  });
});

describe("QueryField autocomplete", () => {
  it("completes the word at the caret", () => {
    const { input, query } = renderField("");
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "is:unr newer_than:7d" } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);
    const item = screen.getByText("is:unread");
    expect(item.closest(".query-autocomplete")).not.toBeNull();
    fireEvent.mouseDown(item);
    expect(query()).toBe("is:unread newer_than:7d");
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
  it("hands out an insert that puts an operator at the caret", () => {
    let insert: ((text: string) => void) | undefined;
    const { input, query } = renderField("is:unread", { onActive: fn => { insert = fn; } });
    fireEvent.focus(input);
    input.setSelectionRange(0, 0);
    fireEvent.select(input);
    insert!("from:");
    expect(query()).toBe("from: is:unread");
    expect(document.activeElement).toBe(input);
  });
});
