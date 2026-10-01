import { describe, expect, it } from "vitest";
import { laterVersionLine, laterVersionOf, type SeriesFile } from "./laterVersion";
import type { FullThread, Thread } from "../api/tauri";

const SEP_19 = Date.UTC(2026, 8, 19, 14, 40);
const SEP_28 = Date.UTC(2026, 8, 28, 12, 0);
const MARTIN = "Martín Ibarra <martin@ibarra-arq.com>";

const listed = (id: string, files: string[], over: Partial<Thread> = {}): Thread => ({
  gmail_thread_id: id, account_id: "a", subject: "Obra Belgrano: ajustes", snippet: "", last_message_date: SEP_28,
  unread_count: 0, labels: [], participants: [MARTIN], has_attachment: true, calendar_event: null,
  attachments: files.map((filename, i) => ({ message_id: `${id}-m${i}`, attachment_id: `x${i}`, filename, mime_type: "application/pdf", size: 1000, inline_data: null, content_id: null })),
  ...over,
});
const full = (id: string, files: string[], from = MARTIN, date = SEP_28): FullThread => ({
  id,
  messages: files.map((_, i) => ({ id: `${id}-m${i}`, threadId: id, internalDate: String(date), payload: { headers: [{ name: "From", value: from }] } })),
});

const file: SeriesFile = {
  filename: "Presupuesto_obra_v2.pdf", date: SEP_19, threadId: "t1", accountId: "a",
  people: ["martin@ibarra-arq.com", "me@x.com"],
};

describe("laterVersionOf", () => {
  const pool = [{ thread: listed("t2", ["Presupuesto_obra_v3.pdf"]), cardId: "c1" }];

  it("points to a newer file of the series that the same person sent in another thread", () => {
    expect(laterVersionOf(file, pool, { t2: full("t2", ["Presupuesto_obra_v3.pdf"]) })).toEqual({
      found: { threadId: "t2", cardId: "c1", subject: "Obra Belgrano: ajustes", who: "Martín", label: "v3", date: SEP_28 },
      missing: [],
    });
  });

  it("asks for the other thread first, to know who sent the file and when", () => {
    expect(laterVersionOf(file, pool, {})).toEqual({ found: null, missing: ["t2"] });
  });

  it("stays silent about the same thread, another account, the same file, a generic name or an older file", () => {
    const fetched = { t2: full("t2", ["Presupuesto_obra_v3.pdf"]) };
    expect(laterVersionOf({ ...file, threadId: "t2" }, pool, fetched).found).toBeNull();
    expect(laterVersionOf({ ...file, accountId: "b" }, pool, fetched).found).toBeNull();
    expect(laterVersionOf(file, [{ thread: listed("t2", ["Presupuesto_obra_v2.pdf"]), cardId: "c1" }], { t2: full("t2", ["Presupuesto_obra_v2.pdf"]) }).found).toBeNull();
    expect(laterVersionOf({ ...file, filename: "Factura_0041.pdf" }, [{ thread: listed("t2", ["Factura_0042.pdf"]), cardId: "c1" }], { t2: full("t2", ["Factura_0042.pdf"]) }).found).toBeNull();
    expect(laterVersionOf({ ...file, date: SEP_28 + 1 }, pool, fetched).found).toBeNull();
  });

  it("stays silent when someone outside this thread sent it", () => {
    const other = "Ana <ana@else.com>";
    const fromOther = [{ thread: listed("t2", ["Presupuesto_obra_v3.pdf"], { participants: [other] }), cardId: "c1" }];
    expect(laterVersionOf(file, fromOther, { t2: full("t2", ["Presupuesto_obra_v3.pdf"], other) })).toEqual({ found: null, missing: [] });
  });

  it("stays silent when the newer message carries a lower version", () => {
    expect(laterVersionOf({ ...file, filename: "Presupuesto_obra_v4.pdf" }, pool, { t2: full("t2", ["Presupuesto_obra_v3.pdf"]) }).found).toBeNull();
  });

  it("goes by the date alone when the names can't be ordered", () => {
    const dated = [{ thread: listed("t2", ["Presupuesto_obra.pdf"]), cardId: "c1" }];
    expect(laterVersionOf(file, dated, { t2: full("t2", ["Presupuesto_obra.pdf"]) }).found).toMatchObject({ label: null, date: SEP_28 });
  });
});

describe("laterVersionLine", () => {
  it("names the person, the version, the day and the thread", () => {
    expect(laterVersionLine({ threadId: "t2", cardId: "c1", subject: "Obra Belgrano: ajustes", who: "Martín", label: "v3", date: SEP_28 }, "en-US"))
      .toEqual({ text: "Martín sent v3 on Sep 28, in “Obra Belgrano: ajustes”.", action: "Open v3" });
  });

  it("says a later one came when the names carry no number", () => {
    expect(laterVersionLine({ threadId: "t2", cardId: "c1", subject: "Obra Belgrano: ajustes", who: "Martín", label: null, date: SEP_28 }, "en-US"))
      .toEqual({ text: "A later one came Sep 28, in “Obra Belgrano: ajustes”.", action: "Open it" });
  });
});
