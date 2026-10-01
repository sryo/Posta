import { describe, expect, it, vi } from "vitest";
import { createUndoStack, type UndoEntry } from "./undoStack";

const entry = (label: string, extra: Partial<UndoEntry> = {}): UndoEntry => ({
  label,
  undo: vi.fn(),
  undone: `Undid ${label}`,
  redo: vi.fn(),
  ...extra,
});

describe("createUndoStack", () => {
  it("undoes the latest action first, then each one before it", () => {
    const stack = createUndoStack();
    const star = entry("Starred “Photos”");
    const archive = entry("Archived “Contract”");
    stack.push(star);
    stack.push(archive);

    expect(stack.undo()?.message).toBe("Undid Archived “Contract”");
    expect(archive.undo).toHaveBeenCalledTimes(1);
    expect(stack.peek()).toBe(star);
    expect(stack.undo()?.message).toBe("Undid Starred “Photos”");
    expect(star.undo).toHaveBeenCalledTimes(1);
    expect(stack.undo()).toBeNull();
    expect(stack.peek()).toBeNull();
  });

  it("says what undoing did in the undo's own words when it gives them", () => {
    const stack = createUndoStack();
    stack.push(entry("Archived “Two”", { undo: () => "Unarchived “Two” · back 2nd in Inbox" }));
    expect(stack.undo()?.message).toBe("Unarchived “Two” · back 2nd in Inbox");
  });

  it("redoes what was undone, which the next undo takes back again", () => {
    const stack = createUndoStack();
    const archive = entry("Archived “Two”");
    stack.push(archive);
    stack.undo();

    expect(stack.redo()).toBe(archive);
    expect(archive.redo).toHaveBeenCalledTimes(1);
    expect(stack.redo()).toBeNull();
    expect(stack.undo()?.entry).toBe(archive);
    expect(archive.undo).toHaveBeenCalledTimes(2);
  });

  it("forgets what could be redone once something new is done", () => {
    const stack = createUndoStack();
    stack.push(entry("Archived “One”"));
    stack.undo();
    stack.push(entry("Starred “Two”"));
    expect(stack.canRedo()).toBe(false);
    expect(stack.redo()).toBeNull();
  });

  it("can't redo an action that has no way back", () => {
    const stack = createUndoStack();
    stack.push(entry("Deleted “Planning”", { redo: undefined }));
    expect(stack.undo()).not.toBeNull();
    expect(stack.canRedo()).toBe(false);
  });

  it("drops an action once it can no longer be undone", () => {
    const stack = createUndoStack();
    const older = entry("Archived “One”");
    const held = entry("Deleted “Planning”");
    stack.push(older);
    stack.push(held);
    stack.drop(held);
    expect(stack.peek()).toBe(older);
    expect(held.undo).not.toHaveBeenCalled();
  });

  it("drops the actions taken in an account", () => {
    const stack = createUndoStack();
    const kept = entry("Archived “One”", { tag: "account:b" });
    stack.push(kept);
    stack.push(entry("Archived “Two”", { tag: "account:a" }));
    stack.undo();
    stack.dropTag("account:a");
    expect(stack.canRedo()).toBe(false);
    expect(stack.peek()).toBe(kept);
  });
});
