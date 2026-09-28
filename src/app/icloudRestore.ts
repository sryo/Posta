// iCloud can take a moment to deliver a layout after sign-in: wait before the
// first pull, and once more before a single retry when it found nothing
export const ICLOUD_RESTORE_DELAYS_MS = { first: 500, retry: 1000 };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function pullLayoutWithRetry(pull: () => Promise<boolean>): Promise<void> {
  await sleep(ICLOUD_RESTORE_DELAYS_MS.first);
  if (await pull()) return;
  await sleep(ICLOUD_RESTORE_DELAYS_MS.retry);
  await pull();
}
