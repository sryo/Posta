import type { FullThread, MessagePart } from "../api/tauri";
import { findHeader } from "./messages";

export interface CidImageRef {
  messageId: string;
  attachmentId: string;
  cid: string;
}

// Inline images (`<img src="cid:...">`) whose bytes Gmail left out of the
// message and that must be downloaded as attachments. Images whose data came
// with the message need no download.
export function cidImagesToFetch(thread: FullThread): CidImageRef[] {
  const found: CidImageRef[] = [];
  const seen = new Set<string>();
  const visit = (messageId: string, parts: MessagePart[] | undefined) => {
    for (const part of parts ?? []) {
      const cid = findHeader(part.headers, "Content-ID")?.replace(/^<|>$/g, "");
      const attachmentId = part.body?.attachmentId;
      if (cid && attachmentId && !part.body?.data && part.mimeType?.startsWith("image/") && !seen.has(cid)) {
        seen.add(cid);
        found.push({ messageId, attachmentId, cid });
      }
      visit(messageId, part.parts);
    }
  };
  for (const msg of thread.messages) visit(msg.id, msg.payload?.parts);
  return found;
}

// A newsletter can hold dozens of inline images; downloading them all at
// once invites rate limiting, which drops images silently
export const CID_DOWNLOAD_CONCURRENCY = 6;

// Downloads the images, keyed by content id; failed downloads are left out
export async function fetchCidImages(
  refs: CidImageRef[],
  download: (messageId: string, attachmentId: string) => Promise<string>,
): Promise<Record<string, string>> {
  const data: Record<string, string> = {};
  let next = 0;
  const worker = async () => {
    while (next < refs.length) {
      const ref = refs[next++];
      try {
        data[ref.cid] = await download(ref.messageId, ref.attachmentId);
      } catch {
        // Left out; the image shows as missing
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CID_DOWNLOAD_CONCURRENCY, refs.length) }, worker));
  return data;
}

// Keeps the most recently used values, loading a missing one once
export function createLruCache<V>(limit: number) {
  const entries = new Map<string, Promise<V>>();
  return {
    getOrLoad(key: string, load: () => Promise<V>): Promise<V> {
      let value = entries.get(key);
      if (value) {
        entries.delete(key);
      } else {
        value = load();
        value.catch(() => { if (entries.get(key) === value) entries.delete(key); });
      }
      entries.set(key, value);
      while (entries.size > limit) entries.delete(entries.keys().next().value!);
      return value;
    },
  };
}
