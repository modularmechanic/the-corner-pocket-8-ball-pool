/** Arena construction and session progression share this playable range. */
export const MAX_LEVEL = 5;
export function normalizeLevel(level: unknown): number {
  const value = Number(level);
  return Math.max(1, Math.min(MAX_LEVEL, Number.isFinite(value) ? Math.floor(value) : 1));
}
