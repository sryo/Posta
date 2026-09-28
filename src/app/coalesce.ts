// One run per key at a time. A request made while its key is running wants
// data newer than that run started with, so it gets one more run afterwards;
// any number of such requests share that run.
export function coalesceByKey<K>(run: (key: K) => Promise<void>): (key: K) => Promise<void> {
  const inFlight = new Map<K, { done: Promise<void>; next: Promise<void> | null }>();

  function start(key: K): Promise<void> {
    const entry: { done: Promise<void>; next: Promise<void> | null } = { done: Promise.resolve(), next: null };
    entry.done = run(key).finally(() => {
      if (inFlight.get(key) === entry && !entry.next) inFlight.delete(key);
    });
    inFlight.set(key, entry);
    return entry.done;
  }

  return (key: K) => {
    const current = inFlight.get(key);
    if (!current) return start(key);
    if (!current.next) {
      current.next = current.done.catch(() => {}).then(() => start(key));
    }
    return current.next;
  };
}
