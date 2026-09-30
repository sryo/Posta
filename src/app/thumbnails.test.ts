import { describe, expect, it, vi } from "vitest";
import { createThumbnails } from "./thumbnails";

describe("createThumbnails", () => {
  it("downloads a preview once and hands the same one to every row that shows it", async () => {
    const fetch = vi.fn(async () => "data");
    const { preview } = createThumbnails(fetch);
    expect(await preview("a", "m", "x")).toBe("data");
    expect(await preview("a", "m", "x")).toBe("data");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("runs a few downloads at a time, starting the rest as they finish", async () => {
    const pending: (() => void)[] = [];
    const fetch = vi.fn(() => new Promise<string>(resolve => pending.push(() => resolve("d"))));
    const { preview } = createThumbnails(fetch);
    const all = Array.from({ length: 5 }, (_, i) => preview("a", "m", String(i)));
    expect(fetch).toHaveBeenCalledTimes(3);
    pending.shift()!();
    await all[0];
    await new Promise(r => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(4);
    const drain = setInterval(() => pending.shift()?.(), 0);
    await Promise.all(all);
    clearInterval(drain);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("tries a failed download again next time", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("data");
    const { preview } = createThumbnails(fetch);
    await expect(preview("a", "m", "x")).rejects.toThrow("offline");
    expect(await preview("a", "m", "x")).toBe("data");
  });
});
