import { describe, expect, it, vi } from "vitest";
import type { FullThread, MessagePart } from "../api/tauri";
import { cidImagesToFetch, fetchCidImages } from "./cidImages";

const image = (cid: string, body: MessagePart["body"], mimeType = "image/png"): MessagePart => ({
  mimeType, headers: [{ name: "Content-Id", value: `<${cid}>` }], body,
});
const thread = (...messages: MessagePart[][]): FullThread => ({
  id: "t",
  messages: messages.map((parts, i) => ({
    id: `m${i}`, threadId: "t", payload: { mimeType: "multipart/related", parts },
  })),
});

describe("cidImagesToFetch", () => {
  it("finds images that must be downloaded, however deeply nested", () => {
    const t = thread(
      [{ mimeType: "multipart/alternative", parts: [{ mimeType: "text/html" }, image("logo@x", { size: 9, attachmentId: "a1" })] }],
      [image("chart@x", { size: 9, attachmentId: "a2" })],
    );
    expect(cidImagesToFetch(t)).toEqual([
      { messageId: "m0", attachmentId: "a1", cid: "logo@x" },
      { messageId: "m1", attachmentId: "a2", cid: "chart@x" },
    ]);
  });

  it("skips images that came with their data, non-images and parts without a content id", () => {
    const t = thread([
      image("inline@x", { size: 9, attachmentId: "a1", data: "AAAA" }),
      image("doc@x", { size: 9, attachmentId: "a2" }, "application/pdf"),
      { mimeType: "image/png", body: { size: 9, attachmentId: "a3" } },
    ]);
    expect(cidImagesToFetch(t)).toEqual([]);
  });

  it("downloads an image quoted again in a later message only once", () => {
    const t = thread([image("logo@x", { size: 9, attachmentId: "a1" })], [image("logo@x", { size: 9, attachmentId: "a9" })]);
    expect(cidImagesToFetch(t)).toHaveLength(1);
  });
});

describe("fetchCidImages", () => {
  it("keys downloaded data by content id and leaves out failed downloads", async () => {
    const download = vi.fn(async (_m: string, attachmentId: string) => {
      if (attachmentId === "bad") throw new Error("404");
      return `data-${attachmentId}`;
    });
    const data = await fetchCidImages([
      { messageId: "m0", attachmentId: "a1", cid: "logo@x" },
      { messageId: "m0", attachmentId: "bad", cid: "gone@x" },
    ], download);
    expect(data).toEqual({ "logo@x": "data-a1" });
    expect(download).toHaveBeenCalledWith("m0", "a1");
  });
});
