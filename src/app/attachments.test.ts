import { describe, expect, it } from "vitest";
import { readFilesAsAttachments } from "./attachments";

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
