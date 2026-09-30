// Previews for image attachments too big to come with the thread list: each is
// downloaded once, the first time a row shows it, a few at a time, and kept
// for the rest of the session up to a limit.

const MAX_AT_ONCE = 3;
const MAX_KEPT = 80;
// Past this a preview costs more than it shows
export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

type Fetch = (accountId: string, messageId: string, attachmentId: string) => Promise<string>;

export function createThumbnails(fetch: Fetch) {
  const kept = new Map<string, Promise<string>>();
  const waiting: (() => void)[] = [];
  let running = 0;

  const next = () => {
    if (running >= MAX_AT_ONCE) return;
    const start = waiting.shift();
    if (start) start();
  };

  function preview(accountId: string, messageId: string, attachmentId: string): Promise<string> {
    const key = `${accountId}:${messageId}:${attachmentId}`;
    const known = kept.get(key);
    if (known) {
      // Most recently used last, so the oldest go first when the limit is reached
      kept.delete(key);
      kept.set(key, known);
      return known;
    }
    const data = new Promise<string>((resolve, reject) => {
      waiting.push(() => {
        running++;
        fetch(accountId, messageId, attachmentId)
          .then(resolve, reject)
          .finally(() => { running--; next(); });
      });
      next();
    });
    // A failed download is tried again next time rather than remembered
    data.catch(() => kept.delete(key));
    kept.set(key, data);
    while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value!);
    return data;
  }

  return { preview };
}
