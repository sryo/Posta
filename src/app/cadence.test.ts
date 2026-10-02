import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import type { Thread } from "../api/tauri";
import { arrivalQuery, createCadence, overdueLine, overdueSenders, recordArrivals } from "./cadence";

const EDESUR = "Edesur <facturas@edesur.com.ar>";
const own = ["me@posta.test"];
const mail = (from: string, date: Date, over: Partial<Thread> = {}): Thread => ({
  gmail_thread_id: `${from}-${date.getTime()}`, account_id: "a", subject: "Factura", snippet: "", last_message_date: date.getTime(),
  unread_count: 0, labels: ["INBOX"], participants: [from], has_attachment: false, attachments: [], calendar_event: null, ...over,
});
// Edesur on the 2nd to 4th of each month from April to September 2026
const monthly = (days = [2, 3, 4, 2, 3, 4], from = EDESUR) =>
  days.map((day, i) => day ? mail(from, new Date(2026, 3 + i, day, 9)) : null).filter((t): t is Thread => t !== null);
const historyOf = (threads: Thread[]) => recordArrivals({}, threads, own);
const oct = (day: number) => new Date(2026, 9, day, 10);

describe("recordArrivals", () => {
  it("keeps each sender's first day of the month, by address", () => {
    const history = historyOf([...monthly(), mail("Edesur <FACTURAS@edesur.com.ar>", new Date(2026, 8, 20))]);
    expect(history["facturas@edesur.com.ar"].months).toEqual({ "2026-04": 2, "2026-05": 3, "2026-06": 4, "2026-07": 2, "2026-08": 3, "2026-09": 4 });
    expect(history["facturas@edesur.com.ar"].sender).toBe(EDESUR);
  });

  it("leaves out conversations and the user's own mail", () => {
    const history = historyOf([
      mail("Ana <ana@acme.co>", new Date(2026, 8, 3), { participants: ["Ana <ana@acme.co>", "me@posta.test"] }),
      mail("me@posta.test", new Date(2026, 8, 3)),
    ]);
    expect(history).toEqual({});
  });

  it("returns the same history when nothing new arrived, so it isn't saved again", () => {
    const history = historyOf(monthly());
    expect(recordArrivals(history, monthly(), own)).toBe(history);
  });
});

describe("overdueSenders", () => {
  it("speaks two days after the latest usual day, while nothing came this month", () => {
    const history = historyOf(monthly());
    expect(overdueSenders(history, oct(5))).toEqual([]);
    expect(overdueSenders(history, oct(6))).toEqual([]);
    expect(overdueSenders(history, oct(7))).toEqual([{ email: "facturas@edesur.com.ar", sender: EDESUR, usualDay: 4 }]);
    expect(overdueSenders(recordArrivals(history, [mail(EDESUR, oct(6))], own), oct(7))).toEqual([]);
  });

  it("forgives one missing month of six", () => {
    expect(overdueSenders(historyOf(monthly([2, 0, 4, 2, 3, 4])), oct(7))).toHaveLength(1);
  });

  it("stops after two misses in a row", () => {
    expect(overdueSenders(historyOf(monthly([2, 3, 4, 2, 0, 0])), oct(7))).toEqual([]);
  });

  it("finds no rhythm in a sender spread over more than four days of the month", () => {
    expect(overdueSenders(historyOf(monthly([1, 3, 5, 2, 3, 4])), oct(9))).toEqual([]);
  });

  it("names at most two senders, the earliest due first", () => {
    const history = historyOf([
      ...monthly([10, 10, 10, 10, 10, 10], "gas@metrogas.com.ar"),
      ...monthly(),
      ...monthly([6, 6, 7, 7, 6, 6], "Payroll <pay@acme.co>"),
    ]);
    expect(overdueSenders(history, oct(20)).map(o => o.usualDay)).toEqual([4, 7]);
  });
});

describe("overdueLine", () => {
  it("says who usually writes by when, by the sender's short name", () => {
    expect(overdueLine({ email: "facturas@edesur.com.ar", sender: EDESUR, usualDay: 4 })).toBe("Edesur usually writes by the 4th. Nothing yet this month.");
    const line = (usualDay: number) => overdueLine({ email: "x@y.z", sender: "no-reply@galicia.com.ar", usualDay });
    expect(line(1)).toBe("galicia.com.ar usually writes by the 1st. Nothing yet this month.");
    expect([2, 3, 11, 12, 13, 21, 22, 23, 31].map(d => line(d).split(" ")[5])).toEqual(["2nd.", "3rd.", "11th.", "12th.", "13th.", "21st.", "22nd.", "23rd.", "31st."]);
  });
});

describe("arrivalQuery", () => {
  it("asks Gmail for the sender's mail since the month began", () => {
    expect(arrivalQuery("facturas@edesur.com.ar", oct(7))).toBe("from:facturas@edesur.com.ar newer_than:7d");
  });
});

describe("createCadence", () => {
  beforeEach(() => localStorage.clear());

  function setup(found: boolean | Error = false) {
    const check = vi.fn(async (_accountId: string, _query: string) => {
      if (found instanceof Error) throw found;
      return found;
    });
    const [threads, setThreads] = createSignal<Thread[] | undefined>(monthly());
    const now = { at: oct(7).getTime() };
    const cadence = createRoot(() => createCadence({
      cards: () => [{ id: "bills", account_id: "a" }],
      threadsOf: () => threads(),
      ownEmails: () => own,
      now: () => now.at,
      check,
    }));
    return { cadence, check, setThreads, now };
  }
  const settle = () => new Promise(r => setTimeout(r, 0));

  it("checks Gmail once before speaking, and keeps the history on this Mac", async () => {
    const { cadence, check } = setup();
    expect(cadence.notices("bills")).toEqual([]);
    await settle();
    expect(check).toHaveBeenCalledWith("a", "from:facturas@edesur.com.ar newer_than:7d");
    expect(cadence.notices("bills").map(n => n.text)).toEqual(["Edesur usually writes by the 4th. Nothing yet this month."]);
    expect(cadence.notices("bills")[0].query).toBe("from:facturas@edesur.com.ar newer_than:40d");
    cadence.notices("bills");
    await settle();
    expect(check).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("cadence:bills")!)["facturas@edesur.com.ar"].months["2026-09"]).toBe(4);
  });

  it("stays quiet when Gmail has the mail somewhere else, or can't be asked", async () => {
    for (const found of [true, new Error("offline")]) {
      const { cadence } = setup(found);
      cadence.notices("bills");
      await settle();
      expect(cadence.notices("bills")).toEqual([]);
    }
  });

  it("goes the moment the mail lands", async () => {
    const { cadence, setThreads } = setup();
    cadence.notices("bills");
    await settle();
    expect(cadence.notices("bills")).toHaveLength(1);
    setThreads([...monthly(), mail(EDESUR, oct(7))]);
    expect(cadence.notices("bills")).toEqual([]);
  });

  it("hides a dismissed sender until next month", async () => {
    const { cadence, now } = setup();
    cadence.notices("bills");
    await settle();
    cadence.dismiss("bills", cadence.notices("bills")[0].email);
    expect(cadence.notices("bills")).toEqual([]);
    expect(JSON.parse(localStorage.getItem("cadenceDismissed")!)).toEqual({ "bills|facturas@edesur.com.ar": "2026-10" });
    now.at = new Date(2026, 10, 8, 10).getTime();
    cadence.notices("bills");
    await settle();
    expect(cadence.notices("bills")).toHaveLength(1);
  });
});

