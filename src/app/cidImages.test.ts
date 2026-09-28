import { describe, expect, it, vi } from "vitest";
import type { FullThread, MessagePart } from "../api/tauri";
import { CID_DOWNLOAD_CONCURRENCY, cidImagesToFetch, createLruCache, fetchCidImages } from "./cidImages";

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

  it("downloads a few images at a time rather than all at once", async () => {
    let inFlight = 0;
    let most = 0;
    const download = async (_m: string, attachmentId: string) => {
      most = Math.max(most, ++inFlight);
      await new Promise(r => setTimeout(r, 1));
      inFlight--;
      return `data-${attachmentId}`;
    };
    const refs = Array.from({ length: 20 }, (_, i) => ({ messageId: "m0", attachmentId: `a${i}`, cid: `c${i}@x` }));
    const data = await fetchCidImages(refs, download);
    expect(Object.keys(data)).toHaveLength(20);
    expect(most).toBe(CID_DOWNLOAD_CONCURRENCY);
  });
});

describe("createLruCache", () => {
  it("loads each key once and forgets the least recently used past its limit", async () => {
    const cache = createLruCache<string>(2);
    const load = vi.fn(async (key: string) => `v-${key}`);
    expect(await cache.getOrLoad("a", () => load("a"))).toBe("v-a");
    expect(await cache.getOrLoad("a", () => load("a"))).toBe("v-a");
    await cache.getOrLoad("b", () => load("b"));
    await cache.getOrLoad("a", () => load("a"));
    await cache.getOrLoad("c", () => load("c"));
    await cache.getOrLoad("b", () => load("b"));
    expect(load.mock.calls.map(c => c[0])).toEqual(["a", "b", "c", "b"]);
  });

  it("does not keep a failed load", async () => {
    const cache = createLruCache<string>(2);
    await expect(cache.getOrLoad("a", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(await cache.getOrLoad("a", async () => "v")).toBe("v");
  });
});
