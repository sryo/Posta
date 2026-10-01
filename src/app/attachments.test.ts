import { describe, expect, it } from "vitest";
import { compareVersions, isCalendarAttachment, isPreviewable, readFilesAsAttachments, seriesKey, versionMarker } from "./attachments";

describe("readFilesAsAttachments", () => {
  it("base64-encodes each file without the data URL prefix", async () => {
    const files = [
      new File(["hello"], "a.txt", { type: "text/plain" }),
      new File([new Uint8Array([0, 255])], "b.bin"),
    ];
    const { attachments, skipped } = await readFilesAsAttachments(files, 1024);
    expect(skipped).toEqual([]);
    expect(attachments).toEqual([
      { filename: "a.txt", mime_type: "text/plain", data: btoa("hello") },
      { filename: "b.bin", mime_type: "application/octet-stream", data: btoa("\u0000ÿ") },
    ]);
  });

  it("skips files over the size limit and says why", async () => {
    const files = [new File(["x".repeat(2048)], "big.txt"), new File(["ok"], "small.txt")];
    const { attachments, skipped } = await readFilesAsAttachments(files, 1024);
    expect(attachments.map(a => a.filename)).toEqual(["small.txt"]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatch(/^big\.txt \(2(\.0)? KB - max /);
  });
});

describe("isCalendarAttachment", () => {
  it("recognises an invite whatever the case of its name or type, as the backend does", () => {
    expect(isCalendarAttachment({ filename: "INVITE.ICS", mime_type: "application/octet-stream" })).toBe(true);
    expect(isCalendarAttachment({ filename: "invite", mime_type: "Text/Calendar" })).toBe(true);
    expect(isCalendarAttachment({ filename: "invite", mime_type: "APPLICATION/ICS" })).toBe(true);
    expect(isCalendarAttachment({ filename: "notes.ics.pdf", mime_type: "application/pdf" })).toBe(false);
  });
});

describe("isPreviewable", () => {
  it("previews images and PDFs in the app, not scripts drawn as images or other files", () => {
    expect(isPreviewable("image/png")).toBe(true);
    expect(isPreviewable("IMAGE/JPEG")).toBe(true);
    expect(isPreviewable("application/pdf")).toBe(true);
    expect(isPreviewable("image/svg+xml")).toBe(false);
    expect(isPreviewable("text/plain")).toBe(false);
  });
});

describe("seriesKey", () => {
  it("names a file's series without its version marker, keeping the extension", () => {
    const key = seriesKey("Presupuesto_obra_v2.pdf");
    expect(key).not.toBeNull();
    for (const name of ["Presupuesto_obra_v3.pdf", "presupuesto_obra.pdf", "Presupuesto_obra (2).pdf", "Presupuesto_obra_final.pdf", "Presupuesto_obra_rev4.pdf", "Presupuesto_obra 2024-09-28.pdf", "Presupuesto_obra_3.pdf", "Presupuesto_obra_v3_final.pdf"]) {
      expect(seriesKey(name), name).toBe(key);
    }
    expect(seriesKey("Presupuesto_obra_v2.docx")).not.toBe(key);
    expect(seriesKey("Presupuesto_cocina_v2.pdf")).not.toBe(key);
  });

  it("forms no series from a short or generic name", () => {
    for (const name of ["Factura_0042.pdf", "Invoice.pdf", "invoice-2024-09.pdf", "Scan 3.pdf", "Document (1).docx", "image001.png", "attachment.pdf", "Untitled.pdf", "Plan_v2.pdf"]) {
      expect(seriesKey(name), name).toBeNull();
    }
  });
});

describe("versionMarker and compareVersions", () => {
  it("reads numbered and dated markers", () => {
    expect(versionMarker("Presupuesto_obra_v3.pdf")).toEqual({ kind: "number", value: 3, label: "v3" });
    expect(versionMarker("Presupuesto_obra (2).pdf")).toEqual({ kind: "number", value: 2, label: "v2" });
    expect(versionMarker("Presupuesto_obra_rev4.pdf")).toEqual({ kind: "number", value: 4, label: "v4" });
    expect(versionMarker("Presupuesto_obra 2024-09-28.pdf")).toEqual({ kind: "date", value: 20240928, label: null });
    expect(versionMarker("Presupuesto_obra.pdf")).toBeNull();
  });

  it("orders markers of a kind, and leaves others unordered", () => {
    const v = (name: string) => versionMarker(name);
    expect(compareVersions(v("a_v3.pdf"), v("a_v2.pdf"))).toBeGreaterThan(0);
    expect(compareVersions(v("a_v2.pdf"), v("a_v3.pdf"))).toBeLessThan(0);
    expect(compareVersions(v("a 2024-09-28.pdf"), v("a 2024-09-01.pdf"))).toBeGreaterThan(0);
    expect(compareVersions(v("a_v3.pdf"), v("a.pdf"))).toBeNull();
    expect(compareVersions(v("a_v3.pdf"), v("a 2024-09-28.pdf"))).toBeNull();
  });
});
