// iCloud can take a moment to deliver a layout after sign-in: wait before the
// first pull, and once more before a single retry when it found nothing
export const ICLOUD_RESTORE_DELAYS_MS = { first: 500, retry: 1000 };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Resolves to whether either pull found a layout
export async function pullLayoutWithRetry(pull: () => Promise<boolean>): Promise<boolean> {
  await sleep(ICLOUD_RESTORE_DELAYS_MS.first);
  if (await pull()) return true;
  await sleep(ICLOUD_RESTORE_DELAYS_MS.retry);
  return pull();
}
