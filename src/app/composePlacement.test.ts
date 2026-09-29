import { describe, expect, it } from "vitest";
import { composePlacement, panelBesideView } from "./composePlacement";

describe("composePlacement", () => {
  it("renders nothing when not composing", () => {
    expect(composePlacement({ composing: false, activeThreadId: "t1", replyThreadId: "t1" })).toBeNull();
  });

  it("shows a new email in the panel even while a thread is open", () => {
    expect(composePlacement({ composing: true, activeThreadId: "t1" })).toBe("panel");
  });

  it("shows a reply or forward inside the thread it belongs to", () => {
    expect(composePlacement({ composing: true, activeThreadId: "t1", replyThreadId: "t1" })).toBe("thread");
    expect(composePlacement({ composing: true, activeThreadId: "t1", forwardThreadId: "t1" })).toBe("thread");
  });

  it("shows a reply to another thread in the panel", () => {
    expect(composePlacement({ composing: true, activeThreadId: "t2", replyThreadId: "t1" })).toBe("panel");
    expect(composePlacement({ composing: true, activeThreadId: null, replyThreadId: "t1" })).toBe("panel");
  });

  it("shows an event reply or forward inside the open event only", () => {
    expect(composePlacement({ composing: true, activeThreadId: null, activeEventId: "e1", replyEventId: "e1" })).toBe("event");
    expect(composePlacement({ composing: true, activeThreadId: null, activeEventId: "e1", forwardEventId: "e1" })).toBe("event");
    expect(composePlacement({ composing: true, activeThreadId: null, activeEventId: "e2", replyEventId: "e1" })).toBe("panel");
    expect(composePlacement({ composing: true, activeThreadId: null, activeEventId: "e1" })).toBe("panel");
  });
});

describe("panelBesideView", () => {
  it("makes room beside an open thread or event for the standalone panel", () => {
    expect(panelBesideView({ placement: "panel", creatingEvent: false, viewOpen: true })).toBe(true);
    expect(panelBesideView({ placement: null, creatingEvent: true, viewOpen: true })).toBe(true);
  });

  it("leaves the view alone when nothing floats beside it", () => {
    expect(panelBesideView({ placement: "thread", creatingEvent: false, viewOpen: true })).toBe(false);
    expect(panelBesideView({ placement: "panel", creatingEvent: true, viewOpen: false })).toBe(false);
  });
});
