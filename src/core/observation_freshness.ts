export const OBSERVATION_FRESHNESS_MS = 5 * 60 * 1000;
export const STALE_OBSERVATIONS_WARNING =
  "Chain observations are stale. Sync before preparing a sweep.";

export function observationsAreStale(
  lastSyncAt: string | undefined,
  hasUnspentOutput: boolean,
  now = Date.now(),
): boolean {
  if (!hasUnspentOutput) return false;
  const syncTime = lastSyncAt ? Date.parse(lastSyncAt) : Number.NaN;
  return !Number.isFinite(syncTime) || now - syncTime > OBSERVATION_FRESHNESS_MS;
}
