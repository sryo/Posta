// Every undoable action of the session, newest last, and those undone since
// the last new action, which can be redone.

export interface UndoEntry {
  // What was done: "Archived “Contract v3”"
  label: string;
  // May say what it did, when only undoing can tell ("· back 2nd in Inbox")
  undo: () => string | void | Promise<void>;
  // What undoing did, unless undo says
  undone?: string;
  // Absent when it can't be done again from here
  redo?: () => void;
  // Lets whoever pushed it drop it again (the account it was taken in)
  tag?: string;
}

export function createUndoStack() {
  let done: UndoEntry[] = [];
  let undone: UndoEntry[] = [];

  return {
    push(entry: UndoEntry) {
      done.push(entry);
      undone = [];
    },
    // The latest action, undone, and what undoing it did
    undo(): { entry: UndoEntry; message: string } | null {
      const entry = done.pop();
      if (!entry) return null;
      const said = entry.undo();
      if (entry.redo) undone.push(entry);
      return { entry, message: typeof said === "string" ? said : entry.undone ?? `Undid: ${entry.label}` };
    },
    redo(): UndoEntry | null {
      const entry = undone.pop();
      if (!entry) return null;
      entry.redo?.();
      done.push(entry);
      return entry;
    },
    peek: (): UndoEntry | null => done[done.length - 1] ?? null,
    canUndo: () => done.length > 0,
    canRedo: () => undone.length > 0,
    drop(entry: UndoEntry) {
      done = done.filter(e => e !== entry);
      undone = undone.filter(e => e !== entry);
    },
    dropTag(tag: string) {
      done = done.filter(e => e.tag !== tag);
      undone = undone.filter(e => e.tag !== tag);
    },
  };
}
