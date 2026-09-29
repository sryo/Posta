// Invite emails ask the calendar for the user's answer; each lookup can
// search several calendars, so a deck of invites must not fire them all at
// once or repeat them. A failed lookup waits for retryFailed (the window
// regaining focus) rather than retrying from every re-render.
export function createRsvpLookups(opts: {
  lookup: (accountId: string, uid: string) => Promise<string | null>;
  onStatus: (key: string, status: string) => void;
  concurrency?: number;
}) {
  const concurrency = opts.concurrency ?? 2;
  const requested = new Set<string>();
  const failed = new Map<string, [string, string]>();
  const queue: [string, string][] = [];
  let running = 0;

  const key = (accountId: string, uid: string) => `${accountId}\n${uid}`;

  function pump() {
    while (running < concurrency && queue.length > 0) {
      const [accountId, uid] = queue.shift()!;
      running++;
      opts.lookup(accountId, uid)
        .then(status => { if (status) opts.onStatus(key(accountId, uid), status); })
        .catch(e => {
          console.warn("Failed to fetch RSVP status:", e);
          failed.set(key(accountId, uid), [accountId, uid]);
        })
        .finally(() => {
          running--;
          pump();
        });
    }
  }

  function request(accountId: string, uid: string) {
    const k = key(accountId, uid);
    if (requested.has(k)) return;
    requested.add(k);
    queue.push([accountId, uid]);
    pump();
  }

  function retryFailed() {
    const retry = [...failed.values()];
    failed.clear();
    for (const [accountId, uid] of retry) {
      requested.delete(key(accountId, uid));
      request(accountId, uid);
    }
  }

  return { key, request, retryFailed };
}
