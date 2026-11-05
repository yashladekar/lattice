export const RETENTION_OPTIONS = [0, 30, 90, 180, 365] as const;

export function retentionCutoff(days: number, now: Date = new Date()): Date | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function isPurgeable(
  deletedAt: string | Date | null | undefined,
  days: number,
  now: Date = new Date(),
): boolean {
  if (!deletedAt) return false;
  const cutoff = retentionCutoff(days, now);
  if (!cutoff) return false;
  const deleted = typeof deletedAt === "string" ? new Date(deletedAt) : deletedAt;
  if (Number.isNaN(deleted.getTime())) return false;
  return deleted.getTime() < cutoff.getTime();
}
