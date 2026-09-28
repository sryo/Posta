export function parseStoredWidth(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = parseInt(raw ?? "", 10);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}
