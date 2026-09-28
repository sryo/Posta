// A stored action order from an older version can lack actions added since,
// which would then never show up, or name actions that no longer exist.
// Keep the stored order for known actions and append the missing ones.
export function normalizeActionOrder(stored: unknown, defaults: string[]): string[] {
  const known = Array.isArray(stored)
    ? stored.filter((key, i): key is string => typeof key === "string" && defaults.includes(key) && stored.indexOf(key) === i)
    : [];
  return [...known, ...defaults.filter(key => !known.includes(key))];
}
