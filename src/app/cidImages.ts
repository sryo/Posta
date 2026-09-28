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

// Downloads the images, keyed by content id; failed downloads are left out
export async function fetchCidImages(
  refs: CidImageRef[],
  download: (messageId: string, attachmentId: string) => Promise<string>,
): Promise<Record<string, string>> {
  const results = await Promise.allSettled(refs.map(async r => ({ cid: r.cid, data: await download(r.messageId, r.attachmentId) })));
  const data: Record<string, string> = {};
  for (const result of results) {
    if (result.status === "fulfilled") data[result.value.cid] = result.value.data;
  }
  return data;
}
