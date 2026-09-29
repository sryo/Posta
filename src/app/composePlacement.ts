// Where an open compose renders. A reply or forward shows inside the thread
// or event it belongs to while that one is open; anything else, including a
// new email started while a thread is open, gets the standalone panel.
export type ComposePlacement = "panel" | "thread" | "event" | null;

export interface ComposeTargets {
  composing: boolean;
  activeThreadId: string | null;
  replyThreadId?: string;
  forwardThreadId?: string;
  activeEventId?: string | null;
  replyEventId?: string;
  forwardEventId?: string;
}

export function composePlacement(t: ComposeTargets): ComposePlacement {
  if (!t.composing) return null;
  if (t.activeThreadId && (t.replyThreadId === t.activeThreadId || t.forwardThreadId === t.activeThreadId)) {
    return "thread";
  }
  if (t.activeEventId && (t.replyEventId === t.activeEventId || t.forwardEventId === t.activeEventId)) {
    return "event";
  }
  return "panel";
}

// The standalone compose panel and the new-event panel float at the left
// edge; an open thread or event moves over to keep its toolbar clear of them
export function panelBesideView(s: { placement: ComposePlacement; creatingEvent: boolean; viewOpen: boolean }): boolean {
  return s.viewOpen && (s.placement === "panel" || s.creatingEvent);
}
